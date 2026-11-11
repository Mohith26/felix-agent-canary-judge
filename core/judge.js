/*
 * Agent Canary Judge core.
 *
 * Anytime-valid canary analysis for a conversational payments agent:
 *  - per (metric, segment) cell, a two-sample mixture SPRT on the difference of rates
 *    (normal-mixture e-process, Johari et al. 2017 / Robbins), valid under continuous monitoring
 *  - multiplicity across all cells with e-BH (Wang & Ramdas 2022)
 *  - mechanical decision rule: roll back on any harmful guardrail discovery, promote when the
 *    primary metric's confidence sequence clears the non-inferiority margin
 *
 * Browser: window.FelixJudge. Node: module.exports.
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Shrunk rate estimate so variance never collapses to zero at tiny counts.
  function rate(x, n) { return (x + 0.5) / (n + 1); }

  /*
   * Mixture SPRT for theta = p_canary - p_base, prior theta ~ N(0, tau^2) around 0.
   * Lambda = sqrt(V/(V+tau^2)) * exp(theta^2 tau^2 / (2 V (V + tau^2)))
   * Lambda is (approximately) a nonnegative martingale under H0: theta = 0, so P(sup Lambda >= 1/alpha) <= alpha.
   */
  function msprt(nb, xb, nc, xc, tau) {
    if (nb < 1 || nc < 1) return { theta: 0, V: Infinity, e: 1, lo: -1, hi: 1 };
    var pb = rate(xb, nb), pc = rate(xc, nc);
    var theta = xc / nc - xb / nb;
    var V = pb * (1 - pb) / nb + pc * (1 - pc) / nc;
    var t2 = tau * tau;
    var logE = 0.5 * Math.log(V / (V + t2)) + theta * theta * t2 / (2 * V * (V + t2));
    return { theta: theta, V: V, logE: logE, e: Math.exp(Math.min(logE, 700)) };
  }

  // Confidence sequence for theta at level alpha (always valid), from the same mixture.
  function confSeq(theta, V, tau, alpha) {
    var t2 = tau * tau;
    var r = Math.sqrt((V * (V + t2) / t2) * (Math.log((V + t2) / V) + 2 * Math.log(1 / alpha)));
    return { lo: theta - r, hi: theta + r };
  }

  // e-BH: reject the k hypotheses with largest e-values, k = max{k : e_(k) >= K / (k alpha)}.
  function eBH(evals, alpha) {
    var K = evals.length;
    var idx = evals.map(function (e, i) { return i; }).sort(function (a, b) { return evals[b] - evals[a]; });
    var kStar = 0;
    for (var k = 1; k <= K; k++) if (evals[idx[k - 1]] >= K / (k * alpha)) kStar = k;
    return idx.slice(0, kStar);
  }

  // Naive comparator used by many teams: a fixed-horizon two-sided z-test re-run at every look.
  function zTest(nb, xb, nc, xc) {
    if (nb < 1 || nc < 1) return { z: 0, p: 1 };
    var pPool = (xb + xc) / (nb + nc);
    var se = Math.sqrt(pPool * (1 - pPool) * (1 / nb + 1 / nc));
    if (se === 0) return { z: 0, p: 1 };
    var z = (xc / nc - xb / nb) / se;
    return { z: z, p: 2 * (1 - normCdf(Math.abs(z))) };
  }
  function normCdf(x) {
    // Abramowitz-Stegun 7.1.26
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  var DEFAULT = {
    alpha: 0.05,
    lookEvery: 100,       // canary conversations between looks
    minCell: 150,         // minimum canary conversations in a cell before it is tested
    margin: -0.01,        // promote if completion CS lower bound > -1 point
    minPromote: 3000,     // minimum canary conversations before promotion
    metrics: [
      { key: 'completed', label: 'Transfer completed', harm: -1, tau: 0.03, primary: true },
      { key: 'handoff', label: 'Handed to a human agent', harm: 1, tau: 0.02, tol: 0.06 },
      { key: 'corrected', label: 'Amount or recipient corrected after confirmation', harm: 1, tau: 0.02, tol: 0.04 }
    ]
  };

  function segKey(c) { return c.corridor + '|' + c.input; }

  // Guardrail cells whose always-valid upper bound (Bonferroni over guardrail cells) still exceeds tolerance.
  function segmentGate(cells, M, cfg) {
    var guard = cells.filter(function (c) { return M[c.mi].harm > 0; });
    var a = cfg.alpha / guard.length, open = [];
    guard.forEach(function (c) {
      var m = M[c.mi];
      if (c.nc < cfg.minCell) { open.push({ cell: c, hi: null }); return; }
      var cs = confSeq(c.theta, c.V, m.tau, a);
      if (cs.hi > m.tol) open.push({ cell: c, hi: cs.hi });
    });
    return { open: open, alpha: a };
  }

  /*
   * Replay a stream of conversations (sorted by time) through the judge.
   * conv: {t (minutes), arm: 'base'|'canary', corridor, input: 'text'|'voice', completed, handoff, corrected}
   */
  function run(convs, segments, cfg) {
    cfg = Object.assign({}, DEFAULT, cfg || {});
    var M = cfg.metrics;
    var cells = [];   // one per metric x (overall + segments)
    var segList = ['ALL'].concat(segments);
    M.forEach(function (m, mi) {
      segList.forEach(function (s) { cells.push({ metric: m.key, mi: mi, seg: s, nb: 0, xb: 0, nc: 0, xc: 0, e: 1, logE: 0, theta: 0, V: Infinity }); });
    });
    var cellIndex = {};
    cells.forEach(function (c, i) { cellIndex[c.metric + '#' + c.seg] = i; });
    var nCanary = 0, history = [], decision = null, naive = null, looks = 0;

    function evaluate(c) {
      var m = M[c.mi];
      if (c.nc < (c.seg === 'ALL' ? 1 : cfg.minCell)) { c.e = 1; c.logE = 0; return; }
      var r = msprt(c.nb, c.xb, c.nc, c.xc, m.tau);
      c.e = r.e; c.logE = r.logE; c.theta = r.theta; c.V = r.V;
    }

    for (var i = 0; i < convs.length; i++) {
      var cv = convs[i], keys = ['ALL', segKey(cv)];
      for (var mi = 0; mi < M.length; mi++) {
        var val = cv[M[mi].key] ? 1 : 0;
        for (var k = 0; k < 2; k++) {
          var c = cells[cellIndex[M[mi].key + '#' + keys[k]]];
          if (cv.arm === 'canary') { c.nc++; c.xc += val; } else { c.nb++; c.xb += val; }
        }
      }
      if (cv.arm !== 'canary') continue;
      nCanary++;
      if (nCanary % cfg.lookEvery !== 0 && i !== convs.length - 1) continue;

      looks++;
      cells.forEach(evaluate);
      var rej = eBH(cells.map(function (c) { return c.e; }), cfg.alpha);
      var harmful = rej.filter(function (j) {
        var c = cells[j]; return Math.sign(c.theta) === M[c.mi].harm && M[c.mi].harm !== 0;
      }).map(function (j) { return cells[j]; });
      var prim = cells[cellIndex[M.filter(function (m) { return m.primary; })[0].key + '#ALL']];
      var pcs = confSeq(prim.theta, prim.V, M[prim.mi].tau, cfg.alpha);
      // naive: overall-only z-tests on every metric at every look
      if (!naive) {
        M.forEach(function (m) {
          var c = cells[cellIndex[m.key + '#ALL']];
          var z = zTest(c.nb, c.xb, c.nc, c.xc);
          if (!naive && z.p < cfg.alpha && Math.sign(z.z) === m.harm) naive = { t: cv.t, nCanary: nCanary, metric: m.key, look: looks };
        });
      }
      history.push({
        t: cv.t, nCanary: nCanary,
        cells: cells.map(function (c) { return { logE: c.logE, theta: c.theta }; }),
        primLo: pcs.lo, primHi: pcs.hi, primTheta: prim.theta, nRej: rej.length
      });
      if (!decision && harmful.length) {
        decision = { action: 'rollback', t: cv.t, nCanary: nCanary, look: looks,
          triggers: harmful.map(function (c) { return { metric: c.metric, seg: c.seg, theta: c.theta, e: c.e, nc: c.nc, xc: c.xc, nb: c.nb, xb: c.xb }; }) };
      } else if (!decision && nCanary >= cfg.minPromote && pcs.lo > cfg.margin && rej.length === 0) {
        // segment gate: every guardrail must be shown non-inferior (within tolerance) in every segment
        var open = segmentGate(cells, M, cfg).open;
        history[history.length - 1].openCells = open.length;
        if (!open.length) decision = { action: 'promote', t: cv.t, nCanary: nCanary, look: looks, triggers: [] };
      }
      if (decision && cfg.stopOnDecision) break;
    }
    cells.forEach(evaluate);
    var finalRej = eBH(cells.map(function (c) { return c.e; }), cfg.alpha);
    return { cells: cells, segments: segList, history: history, decision: decision, naive: naive, looks: looks,
      nCanary: nCanary, finalRejections: finalRej, cfg: cfg, cellIndex: cellIndex };
  }

  // ---------- synthetic traffic ----------
  var CORRIDORS = [
    { code: 'MX', name: 'Mexico', share: 0.46 }, { code: 'GT', name: 'Guatemala', share: 0.16 },
    { code: 'HN', name: 'Honduras', share: 0.13 }, { code: 'SV', name: 'El Salvador', share: 0.10 },
    { code: 'DO', name: 'Dominican Rep.', share: 0.08 }, { code: 'CO', name: 'Colombia', share: 0.07 }
  ];

  /*
   * opts: {seed, hours, perHour, canaryShare, base:{completed,handoff,corrected}, voiceShare,
   *        effects: [{corridor, input, metric, delta}], overall: {metric: delta}}
   */
  function simulate(opts) {
    var rng = mulberry32(opts.seed || 1);
    var out = [], total = Math.round(opts.hours * opts.perHour);
    for (var i = 0; i < total; i++) {
      var t = (i + rng()) * 60 / opts.perHour;   // minutes since canary start
      var u = rng(), acc = 0, cor = CORRIDORS[CORRIDORS.length - 1];
      for (var j = 0; j < CORRIDORS.length; j++) { acc += CORRIDORS[j].share; if (u < acc) { cor = CORRIDORS[j]; break; } }
      var vShare = (opts.voiceShare && opts.voiceShare[cor.code]) || 0.35;
      var input = rng() < vShare ? 'voice' : 'text';
      var arm = rng() < opts.canaryShare ? 'canary' : 'base';
      var p = Object.assign({}, opts.base);
      if (input === 'voice') { p.completed -= 0.03; p.corrected += 0.004; }
      if (arm === 'canary') {
        Object.keys(opts.overall || {}).forEach(function (m) { p[m] += opts.overall[m]; });
        (opts.effects || []).forEach(function (ef) {
          if ((ef.corridor === '*' || ef.corridor === cor.code) && (ef.input === '*' || ef.input === input)) p[ef.metric] += ef.delta;
        });
      }
      var corrected = rng() < p.corrected;
      var handoff = rng() < p.handoff + (corrected ? 0.15 : 0);
      var completed = rng() < p.completed - (corrected ? 0.10 : 0);
      out.push({ t: t, arm: arm, corridor: cor.code, input: input, completed: completed, handoff: handoff, corrected: corrected });
    }
    return out;
  }
  function segments() {
    var s = [];
    CORRIDORS.forEach(function (c) { s.push(c.code + '|text'); s.push(c.code + '|voice'); });
    return s;
  }

  // A/A calibration: how often each method raises a harm alarm when nothing changed.
  function aaCalibration(base, nRuns, seed, cfg) {
    var naiveHits = 0, judgeHits = 0;
    for (var r = 0; r < nRuns; r++) {
      var o = Object.assign({}, base, { seed: seed + r * 7919, effects: [], overall: {} });
      var res = run(simulate(o), segments(), Object.assign({}, cfg || {}, { stopOnDecision: false }));
      if (res.naive) naiveHits++;
      if (res.decision && res.decision.action === 'rollback') judgeHits++;
    }
    return { runs: nRuns, naiveRate: naiveHits / nRuns, judgeRate: judgeHits / nRuns };
  }

  // Replays of the same release under fresh seeds: how often and how fast the judge rolls it back.
  function powerCheck(sim, nRuns, seed, cfg) {
    var hits = 0, ns = [];
    for (var r = 0; r < nRuns; r++) {
      var res = run(simulate(Object.assign({}, sim, { seed: seed + r * 104729 })), segments(), Object.assign({}, cfg || {}, { stopOnDecision: true }));
      if (res.decision && res.decision.action === 'rollback') { hits++; ns.push(res.decision.nCanary); }
    }
    ns.sort(function (a, b) { return a - b; });
    return { runs: nRuns, rollbacks: hits, medianN: ns.length ? ns[Math.floor(ns.length / 2)] : null };
  }

  var api = { powerCheck: powerCheck, mulberry32: mulberry32, msprt: msprt, confSeq: confSeq, eBH: eBH, zTest: zTest, normCdf: normCdf,
    run: run, segmentGate: segmentGate, simulate: simulate, segments: segments, aaCalibration: aaCalibration, CORRIDORS: CORRIDORS, DEFAULT: DEFAULT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FelixJudge = api;
})(this);

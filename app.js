(function () {
  'use strict';
  var J = window.FelixJudge, S = window.FELIX_SCENARIO;
  var CN = {}; J.CORRIDORS.forEach(function (c) { CN[c.code] = c.name; });
  function $(id) { return document.getElementById(id); }
  function pts(x, d) { var v = x * 100; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 2 : d) + ' pt'; }
  function pct(x, n) { return (100 * x / n).toFixed(1) + '%'; }
  function dur(min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h ' + m + ' min'; }
  function fmtN(n) { return n.toLocaleString('en-US'); }
  var ICONS = { chat: 'message-circle', send: 'send', bank: 'landmark', shield: 'shield-check', rocket: 'rocket', check: 'list-checks', tool: 'wrench', grid: 'boxes' };

  var res = J.run(J.simulate(S.sim), J.segments(), { stopOnDecision: true });
  var cfg = res.cfg, M = cfg.metrics, K = res.cells.length;
  var cell = function (m, s) { return res.cells[res.cellIndex[m + '#' + s]]; };
  var dec = res.decision;

  // header
  $('crumbRel').textContent = S.release.id;
  $('relId').textContent = S.release.id + ' vs ' + S.release.baseline;
  $('relTitle').textContent = S.release.title;
  var totalConvs = Math.round(S.sim.hours * S.sim.perHour);
  $('relMeta').innerHTML = 'Canary at <b>' + Math.round(S.sim.canaryShare * 100) + '%</b> of WhatsApp conversations · ' +
    '<b>' + J.CORRIDORS.length + '</b> corridors × text / voice note · started Nov 4, 9:00 AM ET · judge looks every ' + cfg.lookEvery + ' canary conversations';
  var st = $('status');
  if (dec && dec.action === 'rollback') {
    st.textContent = 'Rolled back'; st.className = 'status st-back';
    var tr = dec.triggers[0], rc = tr.xc / tr.nc, rb = tr.xb / tr.nb;
    var seg = tr.seg.split('|');
    $('decision').innerHTML = '<span><b>Rolled back automatically</b> after ' + fmtN(dec.nCanary) + ' canary conversations (' + dur(dec.t) + '). ' +
      'Voice notes to ' + CN[seg[0]] + ': amount or recipient corrected after confirmation in ' + pct(tr.xc, tr.nc) + ' of canary chats vs ' + pct(tr.xb, tr.nb) + ' on baseline (' + (rc / rb).toFixed(1) + '×).</span>' +
      '<span>e = ' + fmtN(Math.round(tr.e)) + ' · threshold ' + fmtN(Math.round(K / cfg.alpha)) + '</span>';
  } else if (dec) {
    st.textContent = 'Promoted'; st.className = 'status st-prom';
    $('decision').innerHTML = '<span><b>Promoted</b> after ' + fmtN(dec.nCanary) + ' canary conversations (' + dur(dec.t) + ').</span>';
  } else {
    st.textContent = 'Running'; st.className = 'status st-run';
    $('decision').innerHTML = '<span><b>No decision yet.</b> Still collecting evidence.</span>';
  }

  // KPIs (state at the decision)
  $('kN').textContent = fmtN(res.nCanary);
  $('kNs').textContent = 'of ' + fmtN(res.nCanary + cell('completed', 'ALL').nb) + ' total · ' + J.segments().length + ' segments';
  function kpi(metric, vId, sId, goodSign) {
    var c = cell(metric, 'ALL'), m = M.filter(function (x) { return x.key === metric; })[0];
    var cs = J.confSeq(c.theta, c.V, m.tau, cfg.alpha);
    var cls = (cs.lo > 0 || cs.hi < 0) ? (c.theta * goodSign > 0 ? 'up' : 'down') : 'flat';
    $(vId).innerHTML = '<span class="' + cls + '">' + pts(c.theta) + '</span>';
    $(sId).textContent = pct(c.xc, c.nc) + ' vs ' + pct(c.xb, c.nb) + ' · 95% CS ' + pts(cs.lo) + ' to ' + pts(cs.hi);
  }
  kpi('completed', 'kC', 'kCs', 1);
  kpi('handoff', 'kH', 'kHs', -1);
  kpi('corrected', 'kX', 'kXs', -1);
  $('kCells').textContent = K;

  // segment grid
  var harmful = {}; (dec && dec.action === 'rollback' ? dec.triggers : []).forEach(function (t) { harmful[t.metric + '#' + t.seg] = true; });
  var gate = J.segmentGate(res.cells, M, cfg), openSet = {};
  gate.open.forEach(function (o) { openSet[o.cell.metric + '#' + o.cell.seg] = true; });
  var thr = Math.log(K / cfg.alpha);
  var tb = $('segT').querySelector('tbody'); tb.innerHTML = '';
  J.CORRIDORS.forEach(function (co) {
    var row = '<tr><td><span class="cflag">' + co.code + '</span>' + co.name + '</td>';
    ['text', 'voice'].forEach(function (inp) {
      var key = 'corrected#' + co.code + '|' + inp, c = res.cells[res.cellIndex[key]];
      var cls = harmful[key] ? 'bad' : (openSet[key] ? 'open' : 'ok');
      var w = Math.max(2, Math.min(100, 100 * Math.max(0, c.logE) / thr));
      row += '<td><div class="cell ' + cls + '"><span class="d">' + (c.nc >= cfg.minCell ? pts(c.theta, 1) : '·') + '</span><span class="n">' + pct(c.xc, c.nc) + ' vs ' + pct(c.xb, c.nb) + ' · n=' + fmtN(c.nc) + '</span><span class="bar"><i style="width:' + w + '%"></i></span></div></td>';
    });
    tb.insertAdjacentHTML('beforeend', row + '</tr>');
  });

  // detail for the flagged cell
  if (dec && dec.action === 'rollback') {
    var t0 = dec.triggers[0], mm = M.filter(function (x) { return x.key === t0.metric; })[0];
    var c0 = cell(t0.metric, t0.seg), cs0 = J.confSeq(c0.theta, c0.V, mm.tau, cfg.alpha / K);
    var sp = t0.seg.split('|');
    $('detail').innerHTML =
      '<div><div class="k">Flagged cell</div><div class="v">' + sp[0] + ' · ' + (sp[1] === 'voice' ? 'voice note' : 'text') + '</div></div>' +
      '<div><div class="k">Canary vs baseline</div><div class="v">' + t0.xc + '/' + fmtN(t0.nc) + ' vs ' + t0.xb + '/' + fmtN(t0.nb) + '</div></div>' +
      '<div><div class="k">Δ, CS at α/K</div><div class="v">' + pts(cs0.lo, 2) + ' to ' + pts(cs0.hi, 1) + '</div></div>' +
      '<div><div class="k">Found at look</div><div class="v">' + dec.look + ' · ' + dur(dec.t) + '</div></div>' +
      '<div class="full">Overall corrections moved only ' + pts(cell('corrected', 'ALL').theta) + ' and completion improved, so an overall dashboard would have shipped this release. ' +
      'Every other corridor and input stayed flat; ' + gate.open.filter(function (o) { return !harmful[o.cell.metric + '#' + o.cell.seg]; }).length + ' guardrail cells were still collecting evidence when the judge stopped.</div>';
  }

  // phone transcript: an illustrative example of the failure pattern in the flagged cell
  var trig = dec && dec.triggers[0];
  $('phTag').textContent = trig ? 'canary · ' + trig.seg.replace('|', ' · ') : 'canary';
  var chat = [
    ['day', 'Hoy'],
    ['me', '<div class="voice">▶<span class="wave"></span>0:06</div><small>11:41</small>'],
    ['bot', 'Listo. Envío de <b>$500 USD</b> a <b>Rosa Martínez</b>, Banco Atlántida ****4417. ¿Confirmas? <small>11:41</small>', true],
    ['me', 'No, son cincuenta. Cinco cero <small>11:42</small>'],
    ['bot', 'Perdón. Corregido: <b>$50 USD</b> a Rosa Martínez. ¿Confirmas? <small>11:42</small>'],
    ['me', 'Sí <small>11:42</small>']
  ];
  $('chat').innerHTML = chat.map(function (x) {
    if (x[0] === 'day') return '<div class="day">' + x[1] + '</div>';
    return '<div class="b ' + x[0] + (x[2] ? ' flag' : '') + '">' + x[1] + '</div>';
  }).join('');
  $('phCap').textContent = 'Illustrative transcript of the pattern behind the flagged cell: a voice note heard as "quinientos" instead of "cincuenta". The customer caught it at confirmation, which is what this guardrail counts.';

  // evidence chart
  (function () {
    var svg = $('evChart'), W = 640, H = 230, L = 40, R = 10, T = 10, B = 26, hist = res.history;
    var trigKey = trig ? 'corrected#' + trig.seg : 'corrected#ALL';
    var series = [
      { k: trigKey, color: '#f26629', w: 2.4 },
      { k: 'corrected#ALL', color: '#082422', w: 1.8 },
      { k: 'completed#ALL', color: '#1fc7c6', w: 1.8 }
    ];
    var ymax = Math.ceil(Math.max(thr + 1, Math.max.apply(null, hist.map(function (h) { return h.cells[res.cellIndex[trigKey]].logE; }))));
    var ymin = -4, xmax = hist[hist.length - 1].nCanary;
    var x = function (n) { return L + (W - L - R) * n / xmax; }, y = function (v) { return T + (H - T - B) * (1 - (Math.max(ymin, v) - ymin) / (ymax - ymin)); };
    var s = '';
    for (var v = ymin; v <= ymax; v += 2) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#0824221f"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" font-size="11" text-anchor="end" fill="#082422b3">' + v + '</text>';
    var step = xmax > 10000 ? 2500 : 1000;
    for (var n = 0; n <= xmax; n += step) s += '<text x="' + x(n) + '" y="' + (H - 6) + '" font-size="11" text-anchor="middle" fill="#082422b3">' + (n / 1000) + 'k</text>';
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(thr) + '" y2="' + y(thr) + '" stroke="#f26629" stroke-dasharray="6 4" stroke-width="1.4"/>';
    s += '<text x="' + (L + 6) + '" y="' + (y(thr) - 6) + '" font-size="11" fill="#b6400c">log(K/α) = ' + thr.toFixed(2) + '</text>';
    series.slice().reverse().forEach(function (se) {
      var p = hist.map(function (h) { return x(h.nCanary).toFixed(1) + ',' + y(h.cells[res.cellIndex[se.k]].logE).toFixed(1); }).join(' ');
      s += '<polyline points="' + p + '" fill="none" stroke="' + se.color + '" stroke-width="' + se.w + '" stroke-linejoin="round"/>';
    });
    if (dec) s += '<circle cx="' + x(dec.nCanary) + '" cy="' + y(hist[hist.length - 1].cells[res.cellIndex[trigKey]].logE) + '" r="5" fill="#fff" stroke="#f26629" stroke-width="2.4"/>';
    svg.innerHTML = s;
    $('keyTrig').textContent = trig ? 'Corrections · ' + CN[trig.seg.split('|')[0]] + ' voice notes' : 'Top cell';
  })();

  // calibration replays (computed after first paint)
  setTimeout(function () {
    var aa = J.aaCalibration(S.sim, S.aa.runs, S.aa.seed);
    var pw = J.powerCheck(S.sim, 20, 5000);
    function row(label, val, color, txt) {
      return '<div class="calrow"><span>' + label + '</span><span class="calbar"><i style="width:' + Math.max(1.5, val * 100) + '%;background:' + color + '"></i></span><b>' + txt + '</b></div>';
    }
    $('cal').innerHTML =
      row('Overall z-test, checked every look', aa.naiveRate, '#082422', Math.round(aa.naiveRate * 100) + '%') +
      row('Canary judge (this page)', aa.judgeRate, '#f26629', Math.round(aa.judgeRate * 100) + '%') +
      row('Judge catches this release', pw.rollbacks / pw.runs, '#60d06f', pw.rollbacks + '/' + pw.runs);
    $('calNote').innerHTML = 'False rollbacks across ' + aa.runs + ' A/A replays of 48 h of traffic. Re-checking a fixed-horizon test at every look raises a false alarm in ' +
      Math.round(aa.naiveRate * 100) + '% of them; the always-valid judge in ' + Math.round(aa.judgeRate * 100) + '%. On ' + pw.runs + ' fresh replays of this release it rolled back ' + pw.rollbacks +
      ' times, after a median of ' + (pw.medianN ? fmtN(pw.medianN) : 'n/a') + ' canary conversations.';
  }, 30);

  // icons
  document.querySelectorAll('i[data-i]').forEach(function (el) { el.setAttribute('data-lucide', ICONS[el.getAttribute('data-i')]); });
  if (window.lucide) window.lucide.createIcons();
})();

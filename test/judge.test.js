'use strict';
const test = require('node:test');
const assert = require('node:assert');
const J = require('../core/judge.js');
const S = require('../data/scenario.js');

test('mSPRT e-value is ~1 or below with no difference and grows with a real one', () => {
  const same = J.msprt(5000, 60, 1000, 12, 0.02);
  assert.ok(same.e < 1, 'no difference should give e < 1, got ' + same.e);
  const diff = J.msprt(5000, 60, 1000, 50, 0.02);
  assert.ok(diff.e > 1000, 'large difference should give large e, got ' + diff.e);
});

test('confidence sequence contains the estimate and shrinks with more data', () => {
  const a = J.msprt(1000, 20, 300, 9, 0.02), b = J.msprt(10000, 200, 3000, 90, 0.02);
  const csA = J.confSeq(a.theta, a.V, 0.02, 0.05), csB = J.confSeq(b.theta, b.V, 0.02, 0.05);
  assert.ok(csA.lo < a.theta && a.theta < csA.hi);
  assert.ok(csB.hi - csB.lo < csA.hi - csA.lo);
});

test('e-BH rejects nothing below K/alpha and the right set above it', () => {
  assert.deepStrictEqual(J.eBH([1, 2, 3, 10], 0.05), []);
  const rej = J.eBH([200, 1, 1, 1, 50], 0.05); // K=5: need e_(1) >= 100, e_(2) >= 50
  assert.deepStrictEqual(rej.sort(), [0, 4]);
});

test('normal CDF is accurate', () => {
  assert.ok(Math.abs(J.normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(J.normCdf(0) - 0.5) < 1e-9);
});

test('mixture SPRT keeps type I error under continuous monitoring (single cell)', () => {
  const rng = J.mulberry32(3); let hits = 0; const runs = 300;
  for (let r = 0; r < runs; r++) {
    let nb = 0, xb = 0, nc = 0, xc = 0, hit = false;
    for (let i = 0; i < 4000 && !hit; i++) {
      const canary = rng() < 0.25, y = rng() < 0.05 ? 1 : 0;
      if (canary) { nc++; xc += y; } else { nb++; xb += y; }
      if (canary && nc % 25 === 0 && nc >= 100 && J.msprt(nb, xb, nc, xc, 0.02).e >= 20) hit = true;
    }
    if (hit) hits++;
  }
  assert.ok(hits / runs <= 0.07, 'type I error ' + hits / runs);
});

test('scenario: judge rolls back on the planted Honduras voice-note regression', () => {
  const r = J.run(J.simulate(S.sim), J.segments(), { stopOnDecision: true });
  assert.ok(r.decision && r.decision.action === 'rollback');
  assert.strictEqual(r.decision.triggers[0].seg, 'HN|voice');
  assert.strictEqual(r.decision.triggers[0].metric, 'corrected');
  // counts are consistent: overall = sum of segments
  const ci = r.cellIndex, segs = J.segments();
  for (const m of ['completed', 'handoff', 'corrected']) {
    const all = r.cells[ci[m + '#ALL']];
    const sum = segs.reduce((a, s) => { const c = r.cells[ci[m + '#' + s]]; return { nc: a.nc + c.nc, xc: a.xc + c.xc, nb: a.nb + c.nb, xb: a.xb + c.xb }; }, { nc: 0, xc: 0, nb: 0, xb: 0 });
    assert.deepStrictEqual({ nc: all.nc, xc: all.xc, nb: all.nb, xb: all.xb }, sum);
  }
});

test('A/A replays: judge does not roll back, naive peeking often does', () => {
  const aa = J.aaCalibration(S.sim, 10, 1000);
  assert.strictEqual(aa.judgeRate, 0);
  assert.ok(aa.naiveRate > 0.2, 'naive rate ' + aa.naiveRate);
});

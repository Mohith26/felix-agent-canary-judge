// Seeded synthetic release scenario (no real Félix data). Loaded by the page and by the tests.
// Release r2026.11.04-b: shorter confirmations + a new voice-note transcription model.
// Ground truth built into the simulator: completion +0.8 pt and handoff -0.4 pt overall, but
// voice notes in the Honduras corridor get +3.5 pt more amount/recipient corrections.
(function (root) {
  var SCENARIO = {
    release: { id: 'r2026.11.04-b', title: 'Shorter confirmations + new voice-note transcription model', baseline: 'r2026.10.28-a', start: '2026-11-04T09:00:00-05:00' },
    sim: {
      seed: 11, hours: 48, perHour: 3000, canaryShare: 0.25,
      base: { completed: 0.78, handoff: 0.06, corrected: 0.012 },
      voiceShare: { MX: 0.30, GT: 0.42, HN: 0.45, SV: 0.38, DO: 0.25, CO: 0.20 },
      overall: { completed: 0.008, handoff: -0.004 },
      effects: [{ corridor: 'HN', input: 'voice', metric: 'corrected', delta: 0.035 }]
    },
    aa: { runs: 40, seed: 1000 }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SCENARIO; else root.FELIX_SCENARIO = SCENARIO;
})(this);

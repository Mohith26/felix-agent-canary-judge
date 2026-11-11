# Agent Canary Judge for Félix (concept)

**Live demo:** https://mohith26.github.io/felix-agent-canary-judge/

An unofficial concept feature for Félix's WhatsApp agent: an anytime-valid canary judge for agent releases (prompt, model, tool or transcription changes). It watches every corridor × input segment (text vs voice note) at once, rolls a release back the moment any money-safety guardrail gets worse in any segment, and only promotes once every segment has been shown safe within a tolerance.

Built by Mohith Gajjela (Duke CS). Not affiliated with Félix. **All traffic is synthetic**; the transcript is illustrative.

## Why

Agent releases at a payments company fail in narrow places. A new transcription model can be better overall and still mishear amounts in one accent ("quinientos" for "cincuenta"). Overall dashboards average that away, and teams that re-check a normal A/B test every hour get frequent false alarms because a fixed-horizon test is not built to be peeked at.

## How it works

- **Cells.** 3 metrics (transfer completed; handed to a human; amount or recipient corrected after the bot's confirmation) × (overall + 6 corridors × {text, voice note}) = 39 hypotheses.
- **Per-cell evidence.** A two-sample mixture SPRT on the difference in rates (normal-mixture e-process, as in Johari et al. 2017). Its value can be checked after every conversation without inflating error, and it comes with an always-valid confidence sequence.
- **Multiplicity.** e-BH (Wang & Ramdas 2022) across all 39 cells at α = 5% at every look (every 100 canary conversations).
- **Decision rule, written down before the canary starts.** Roll back on any harmful guardrail discovery. Promote when overall completion's confidence sequence clears −1 pt and every guardrail cell's upper bound (Bonferroni across guardrail cells) is inside tolerance (+4 pt corrections, +6 pt handoff).

Everything on the page is computed in the browser by `core/judge.js` from the seeded scenario in `data/scenario.js`.

## Result (synthetic scenario, seed 11)

Release r2026.11.04-b: 25% canary over ~3,000 conversations/hour. Built-in truth: completion +0.8 pt and handoff −0.4 pt overall, but voice notes to Honduras get +3.5 pt more corrections.

- The judge rolled back after **12,700 canary conversations (16 h 55 min)**: Honduras voice-note corrections were 5.1% on the canary vs 1.5% on baseline (3.5×). Overall corrections had moved only +0.11 pt.
- Over 20 fresh replays of this release it rolled back 20/20 (median ~15,000 canary conversations).
- Over 40 A/A replays (canary identical to baseline), re-checking an overall z-test at every look raised a false alarm in 68%; the judge in 0%.

## Run it

```
node --test          # 7 unit tests
open index.html      # or serve the folder statically
```

## Honest limitations

- Synthetic traffic with independent conversations; real traffic has repeat users and time-of-day effects (a per-user or per-hour blocked design would fix that).
- The mixture SPRT uses a normal approximation, which is rough for rare events in small cells; cells under 150 canary conversations are not tested, and an exact Bernoulli betting e-process would be the production choice.
- The judge is conservative: 0% false rollbacks here, but good releases often need more than 48 h to clear the per-segment gate on thin segments (e.g. Colombia voice notes).
- Tolerances, τ and the segment list are settings, not learned.

## Novelty note

Félix's site, help center, press (Series A/B/C), Circle and a16z write-ups and their engineering leaders' public posts describe the WhatsApp agent and the Maestro/OpenClaw runtime but no automated canary analysis for agent releases. Generic tools exist: LaunchDarkly guarded rollouts and Statsig sequential tests for feature flags, and agent platforms like Replicant describe canary releases for their own agents. None of those publish segment-level, e-BH-controlled money-safety guardrails for a conversational payments agent.

## UI

Félix's internal tools are not public. The shell uses felixpago.com's design tokens (slate #082422, brand cyan #2bf2f1, lime #dcff00, papaya #f26629, cactus #60d06f, stone #edebe9, 1 rem card radius), the Félix wordmark, and a WhatsApp transcript styled after the chat screenshots on felixpago.com. Fonts: Félix uses licensed Saans and Plain; this demo uses Hanken Grotesk as an open stand-in.

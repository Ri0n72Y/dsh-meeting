# Test contracts and verification boundaries

The test suite protects independently observable production contracts, not a fixed test count or the implementation's internal call order. This note records the current ownership decisions for PR #8; it is not a testing framework.

| Owner | Contract and discriminating counterexample | Routine protection |
| --- | --- | --- |
| `wav.ts` | Canonical PCM16 round-trip and header rejection; wrong rate, truncated WAV or quantization boundary cannot pass | `wav.test.ts` |
| `audio-files.ts` | Resume uses durable sample counts, rejects gaps/corruption, never replaces an existing index; repeated index must fail without altering the original | `audio-files.test.ts` |
| `ContinuousCapture` | Producer chunking does not alter persisted windows; stop preserves accepted tail; failure/cancel do not lose accepted PCM; slow ASR bounds intake | `capture.test.ts` |
| `MeetingStore` / Workspace | Invalid lines, nonmonotonic times, stopped Session, and path escapes fail without mutating committed state; session data remains isolated | `context.test.ts` |
| `SessionCaptureRegistry` | Concurrent stop/dispose settles once and releases the lease even when settlement fails | `lifecycle.test.ts` |
| `markdown.ts` | A transcript is an escaped, time-stamped projection; sequentially persisted Markdown matches the rendered transcript; concurrent replacement/failure atomicity is not currently exercised | `markdown.test.ts` |
| `SpeakerTracker` / Timeline | Identity is session-scoped, malformed embedding gets no label, and segment times come from observed boundaries | `speaker.test.ts`, `timeline.test.ts` |
| `WindowsLoopback` JS adapter | Native PCM callback splitting cannot change output; silence advances time; abnormal gaps and native overflow are observable failures; callback drain preserves accepted samples | `windows-loopback.test.ts` |
| `SummaryJobs` | Concurrent checkpoints coalesce; one final pass follows active work even if a checkpoint failed; Sessions remain independent | `summary-jobs.test.ts` |
| `summary-batch.ts` | Durable cursors advance by whole segments, and chunked summaries never omit or reintroduce segments | `summary-batch.test.ts` |

## Newly explicit native and timing limits

The N-API TSFN admits at most 256 outstanding audio callbacks plus two reserved control packets (overrun and terminal marker). An overflow raises an observable adapter error and interrupts capture; it must not silently discard accepted audio. The JavaScript callback simulation tests only propagation of this status, **not** contention in the real native queue. A clean native build and actual callback behavior must be verified on Windows during manual acceptance.

A single reported WASAPI frame-position gap exceeding ten minutes is treated as an invalid device timestamp and interrupts capture rather than generating an unbounded silent PCM stream. This is an explicit safeguard, not a claim that all long periods of real silence have been tested. The threshold should be revisited with real hardware recordings.

## Verification placement

- **Focused CI** on non-documentation pushes to repository branches: one typecheck, focused contract tests, one build. Tests use public unit/port APIs rather than fabricated Host internals.
- **Local Windows build check** whenever the native addon source, build configuration or Node ABI target changes: clean the previous native output, compile from source using Node 24, and load the new N-API binary. A cached `.node` file does not count.
- **Manual DSH deployment** when registration, manifests or Host/client interfaces change: install into the real DSH environment and verify the plugin loads and its entry points register. Web-only registration is not evidence of a working Desktop meeting.
- **Issue #7 release acceptance** in real Windows DSH Desktop: Sidebar Start/Stop, playback capture, SenseVoice, Session-scoped WAV/transcript, Session switching, stream updates and LLM final summary. Use [Windows acceptance](windows-acceptance.md) and retain evidence before release.

The two cloud workflows for Windows compilation and DSH Web startup were removed; no separate manual-only GitHub workflows are retained. Focused CI still has manual dispatch and cancels obsolete same-branch runs. Fork PRs are not checked automatically; verify their changes in a trusted branch before merging. CI success is not native or Desktop acceptance.

## Deliberately uncovered at routine test scope

`MeetingControl` device lifecycle, Typert streaming `watch`, UI scroll anchoring, SenseVoice inference accuracy, native callback synchronization, real Agent busy/resume behavior and end-to-end summary visibility require genuine integration or physical acceptance. They were formerly claimed in tests that bypassed constructors and assigned private `live`, `state` and `summaries` fields. Removing those tests **removes their simulation**, not the production requirements.

Do not restore that fixture merely to raise the check count. If a real execution fails, trace its first responsible boundary and add the smallest discriminating check; do not make a mock runtime stand in for DSH itself.

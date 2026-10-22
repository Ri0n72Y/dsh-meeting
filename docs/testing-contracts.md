# Test contracts and verification boundaries

The test suite protects independently observable production contracts, not a fixed test count or the implementation's internal call order. This note records the current ownership decisions for PR #8; it is not a testing framework.

| Owner | Contract and discriminating counterexample | Routine protection |
| --- | --- | --- |
| `wav.ts` | Canonical PCM16 round-trip and header rejection; wrong rate, truncated WAV or quantization boundary cannot pass | `wav.test.ts` |
| `audio-files.ts` | Resume uses durable sample counts, rejects gaps/corruption, never replaces an existing index; repeated index must fail without altering the original | `audio-files.test.ts` |
| `ContinuousCapture` | Producer chunking does not alter persisted windows; stop preserves accepted tail; failure/cancel do not lose accepted PCM; slow ASR bounds intake | `capture.test.ts` |
| `MeetingStore` / Workspace | Invalid lines, nonmonotonic times, stopped Session, and path escapes fail without mutating committed state; session data remains isolated | `context.test.ts` |
| `SessionCaptureRegistry` | Concurrent stop/dispose settles once and releases the lease even when settlement fails | `lifecycle.test.ts` |
| `markdown.ts` | A transcript is an escaped, time-stamped projection; disk writes expose full prior or new document, not half-written content | `markdown.test.ts` |
| `SpeakerTracker` / Timeline | Identity is session-scoped, malformed embedding gets no label, and segment times come from observed boundaries | `speaker.test.ts`, `timeline.test.ts` |
| `WindowsLoopback` JS adapter | Native PCM callback splitting cannot change output; silence advances time; callback drain, backpressure and stop errors preserve accepted samples | `windows-loopback.test.ts` |
| `SummaryJobs` | Concurrent checkpoints coalesce; one final pass follows active work even if a checkpoint failed; Sessions remain independent | `summary-jobs.test.ts` |
| `summary-batch.ts` | Durable cursors advance by whole segments, and chunked summaries never omit or reintroduce segments | `summary-batch.test.ts` |

## Verification placement

- **Focused checks** on every PR: typecheck, focused contract tests, one build. Test code uses public unit/port APIs, not `Object.create(Service.prototype)` plus private maps or a fabricated Host lifecycle.
- **DSH Web integration** when its plugin boundaries change: install the actual DSH 0.2.0-rc.2 profile, boot the actual Web Host, confirm the UI contribution, and exercise a real Gateway dispatch/error-transport boundary. The non-existent-Session RPC is a registration smoke check, not evidence of a usable meeting.
- **Windows native** on WASAPI source/packaging changes: compile and load the real N-API addon. JavaScript callback mocks in routine tests do *not* verify Windows Media Foundation callback threading.
- **Issue #7 release acceptance** on physical Windows Desktop: Sidebar Start/Stop, actual system playback, official SenseVoice, Workspace WAV/transcript, Session switching, Agent-busy scheduling and LLM-generated final summary. Retain screenshots/logs and actual error paths as release evidence; do not add a large synthetic E2E harness to every PR.

## Deliberately uncovered at routine test scope

`MeetingControl` device lifecycle, Typert streaming `watch`, UI scroll anchoring, SenseVoice inference accuracy, native callback synchronization, real Agent busy/resume behavior and end-to-end summary visibility require genuine integration or physical acceptance. They were formerly claimed in tests that bypassed constructors and assigned private `live`, `state` and `summaries` fields. Removing those tests **removes their simulation**, not the production requirements.

Do not restore that fixture merely to raise the check count. If a real execution fails, trace its first responsible boundary and add the smallest discriminating check; do not make a mock runtime stand in for DSH itself.

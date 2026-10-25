# Meeting P0 milestones and acceptance

Target: DSH `0.2.1-rc.3` with the official Voice Input / SenseVoice provider. Full product scope and mandatory real-Windows acceptance are defined in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7).

## Implemented source capabilities

- **Context:** One meeting per DSH Session; durable `state.json`, `transcript.md`, `summary.md` and WAV windows under the Session Workspace; safe Session IDs, restart and interruption recovery.
- **Capture:** `WindowsLoopback` adapts system-playback WASAPI data to 16 kHz mono PCM and uses `ContinuousCapture` for durable windows, bounded ASR, silence handling and cancellation. `meeting_capture_file` remains an independent Agent-facing file transcription tool.
- **Speaker:** Optional local diarization, Session-scoped anonymous Speaker labels, no fabricated word alignment if several speakers overlap.
- **Meeting UI:** Host MeetingControl, official Typert Gateway contribution and DSH Sidebar tab for Start/Stop, read-only transcript/summary, manual/periodic and final summary.

## Verification status

Focused CI tests component contracts, typechecks, builds the single root npm bundle's four Host entries and Client factory, and inspects its packed artifacts. Native Windows compilation/loading and DSH profile registration now require manual deployment checks, rather than dedicated cloud CI jobs. Details and uncovered contracts: [testing-contracts.md](testing-contracts.md); release checks: [windows-acceptance.md](windows-acceptance.md).

**Not established by focused CI:** native addon compatibility, DSH plugin registration, physical Windows system-audio capture; actual official SenseVoice transcription quality and readiness; real DSH Sidebar interaction, streamed view updates, Session switching and document scroll behavior; actual LLM summary output, busy-Agent deferral and final summary. These require the release/acceptance evidence in Issue #7. A successful simulated PCM test, mocked callback or Gateway error-roundtrip is not a substitute.

## Known functional limits

- Existing durable WAV windows are not automatically replayed into missing transcript segments after a crash that occurred between persistence and ASR settlement.
- The separately exported `BrowserMicrophone` and example page are not the DSH meeting audio source; P0 uses Windows system playback.

# First three independently observable capabilities

Baseline: DSH `dsh-v0.2.0-rc.2`. This iteration **assumes**, rather than validates, official Speech and sherpa-onnx Windows support.

## C1 — Meeting Context
- One meeting per real DSH Session id; no parallel meeting identifier.
- `begin`, `resume`, `interrupt`, `append`, `finish`, `read` on a persistent, Session-keyed store under `<Session.cwd>/.dsh-meeting/<sessionId>/`.
- Tool `meeting_status` is visible in the Agent conversation.
- `state.json` is temporary internal storage; Markdown format is deferred.

## C2 — Meeting Capture
- Host service `start(sessionId)` → `await push(sessionId, Float32Array @ 16 kHz)` → `stop()` persists a continuous stream as timed PCM windows with a bounded asynchronous ASR queue.
- Persist **all** accepted PCM windows including silent and sub-350ms final tails; silence gate prevents unnecessary ASR calls. Slow recognition backpressures `push`.
- The exact official `speechToText.resolve({ providerId: 'sensevoice-local' })` and `transcribe` route generates text.
- ASR failure keeps audio and allows later windows to proceed; disk errors and caller cancellation mark the meeting `interrupted` for explicit resumption.
- Browser `BrowserMicrophone` provides independently usable native capture with resampling; `examples/microphone.html` shows elapsed captured samples.
- Agent tool `meeting_capture_file` exercises the complete Host processing path against an existing WAV.
- **Not done:** DSH browser→Host PCM Remote and interactive Sidebar controls.

## C3 — Meeting Speaker
- Upstream `SpeakerEmbeddingExtractor`, `SpeakerEmbeddingManager`, and optional `OfflineSpeakerDiarization` APIs, without Python.
- Session-local numbering; no persistent biometric identity.
- Capture returns `turns` for mixed windows, but does **not** falsely align ASR words to speaker turns.
- Without the models, labels are null rather than fabricated.

## Checks and honest limitations
- `tests/context.test.ts`: isolation, persistence, serialized writes, crash/restart and interrupted recovery.
- `tests/capture.test.ts`: continuity, sub-350ms tail, storage failure, backpressure under slow ASR and cancellation.
- `tests/speaker.test.ts` and `tests/timeline.test.ts`: local IDs, recovery-safe numbering, speaker turn boundaries.\n- `tests/audio-files.test.ts`: recovered sample offsets and contiguous durable audio windows.\n- `tests/browser.test.ts`: concurrent microphone permission and stop race.
- `pnpm proof`: deterministic simulated audio, mocked model, visibly formatted terminal output, **not** proof of ASR/diarization quality.
- Live Windows microphone/system-loopback, DER/WER, DSH end-to-end and package installation are **unverified**. They are later acceptance work, intentionally not claimed here.

## Remaining non-blocking acceptance gaps
- Recovery retains all committed PCM and resumes from its actual sample offset. Previously persisted windows that crashed before ASR settlement may require a later replay pass; this iteration does not claim complete transcript backfill.
- Host microphone capture can only be continuous when the future browser→Host transport honors the awaitable `push` backpressure contract. Native Windows mic/system-loopback remains unverified by design.

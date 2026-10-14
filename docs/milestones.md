# First three independently observable capabilities

Baseline: DSH `dsh-v0.2.0-rc.2`. This iteration **assumes**, rather than validates, official Speech and sherpa-onnx Windows support.

## C1 — Meeting Context
- One meeting per real DSH Session id; no parallel meeting identifier.
- `begin`, `append`, `finish`, `read` on a persistent, Session-keyed store.
- Tool `meeting_status` is visible in the Agent conversation.
- `state.json` is temporary internal storage; Markdown format is deferred.

## C2 — Meeting Capture
- Host service `start(sessionId)` → `push(Float32Array @ 16 kHz)` → `stop()` processes a continuous stream into time-stamped windows.
- Persist **all** windows including silence; silence gate prevents unnecessary ASR calls.
- The exact official `speechToText.resolve({ providerId: 'sensevoice-local' })` and `transcribe` route generates text.
- ASR failure keeps audio and allows later windows to proceed.
- Browser `BrowserMicrophone` provides independently usable native capture with resampling; `examples/microphone.html` shows elapsed captured samples.
- Agent tool `meeting_capture_file` exercises the complete Host processing path against an existing WAV.
- **Not done:** DSH browser→Host PCM Remote and interactive Sidebar controls.

## C3 — Meeting Speaker
- Upstream `SpeakerEmbeddingExtractor`, `SpeakerEmbeddingManager`, and optional `OfflineSpeakerDiarization` APIs, without Python.
- Session-local numbering; no persistent biometric identity.
- Capture returns `turns` for mixed windows, but does **not** falsely align ASR words to speaker turns.
- Without the models, labels are null rather than fabricated.

## Checks and honest limitations
- `tests/context.test.ts`: isolation, persistence, serialized writes.
- `tests/capture.test.ts`: continuity, timestamps, silence persistence, ASR failure isolation.
- `tests/speaker.test.ts` and `tests/timeline.test.ts`: local IDs, anonymous speaker turn boundaries.
- `pnpm proof`: deterministic simulated audio, mocked model, visibly formatted terminal output, **not** proof of ASR/diarization quality.
- Live Windows microphone/system-loopback, DER/WER, DSH end-to-end and package installation are **unverified**. They are later acceptance work, intentionally not claimed here.

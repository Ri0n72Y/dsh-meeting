# dsh-meeting

Session-scoped meeting recording and transcription plugin for **DeepSeek Harness >=0.2.1-rc.3** (Node.js 24). The verification target is `0.2.1-rc.3`; later versions require separate runtime confirmation. The DSH right Sidebar starts/stops Windows x64 system-playback capture and displays read-only Markdown transcript and rolling summary.

- `meeting-context`: durable Session state, transcript and summary in the Session Workspace.
- `meeting-capture`: WASAPI → 16 kHz PCM → bounded WAV persistence → official `sensevoice-local` transcription.
- `meeting-speaker`: optional local speaker identification.
- `meeting-ui`: DSH Sidebar controls, Typert Remote, summary scheduling.

The combined bundle is `bundles/dsh-meeting/cordis.patch.yml`. Install the official DSH Voice Input Bundle for SpeechToText; this project does not provide a replacement ASR. The Windows N-API addon is built from `packages/meeting-capture/native`.

## Verification

Automated CI is limited to focused contract tests, one typecheck, one build and the built Client lazy-CJS contract check. Native changes require a clean local Windows build and load check; DSH installation and end-to-end behavior are verified manually. See [verification boundaries](docs/testing-contracts.md), [installation](docs/installation.md) and [Windows acceptance](docs/windows-acceptance.md).

Focused CI does **not** establish native Windows compatibility, a working desktop audio source or real SenseVoice/LLM output. Issue [#7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) requires physical Windows DSH acceptance from Sidebar Start through final summary before the feature is considered complete.

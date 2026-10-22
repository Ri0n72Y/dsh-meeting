# dsh-meeting

Session-scoped meeting recording and transcription plugin for **DeepSeek Harness 0.2.0-rc.2** (Node.js 24). The DSH right Sidebar starts/stops Windows x64 system-playback capture and displays read-only Markdown transcript and rolling summary.

- `meeting-context`: durable Session state, transcript and summary in the Session Workspace.
- `meeting-capture`: WASAPI → 16 kHz PCM → bounded WAV persistence → official `sensevoice-local` transcription.
- `meeting-speaker`: optional local speaker identification.
- `meeting-ui`: DSH Sidebar controls, Typert Remote, summary scheduling.

The combined bundle is `bundles/dsh-meeting/cordis.patch.yml`. Install the official DSH Voice Input Bundle for SpeechToText; this project does not provide a replacement ASR. The Windows N-API addon is built from `packages/meeting-capture/native`.

## Verification

Daily CI runs focused contract tests, a typecheck and a build. DSH Web integration and Windows native compilation run as separate path-scoped workflows. See [test ownership and acceptance boundaries](docs/testing-contracts.md) and [installation](docs/installation.md).

These checks do **not** establish a working Windows desktop audio source or real SenseVoice/LLM output. Issue [#7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) requires physical Windows DSH acceptance from Sidebar Start through final summary before the feature is considered complete.

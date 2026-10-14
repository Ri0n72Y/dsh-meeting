# dsh-meeting

Three independently loadable meeting capabilities for **DeepSeek Harness 0.2.0-rc.2** (Node.js 24): context, continuous capture and speaker diarization. This is an initial vertical slice; Markdown format, live summary and final Sidebar UX are out of scope.

- `@ri0n72y/dsh-meeting-context`: Session-keyed durable meeting state and Agent-visible `meeting_status`.
- `@ri0n72y/dsh-meeting-capture`: continuous 16 kHz PCM ingestion, bounded audio windows, exact official `speechToText` / `sensevoice-local` routing, plus the Agent-visible `meeting_capture_file` proof path. Independent browser microphone capture is provided at the `./browser` export.
- `@ri0n72y/dsh-meeting-speaker`: optional sherpa-onnx per-window diarization, speaker embeddings and Session-scoped anonymous labels; independent of ASR.

The combined bundle is `bundles/dsh-meeting/cordis.patch.yml`. Activate the **official DSH Voice Input Bundle** first so `speechToText` and `sensevoice-local` are registered. We do not register a replacement ASR provider.

## Observable outcomes

| Capability | Visible output | Focused proof |
| --- | --- | --- |
| Context | `meeting_status` returns Session phase, revision, speakers and latest lines | `tests/context.test.ts` and persistent `state.json` |
| Capture | `meeting_capture_file` returns timed recognized segments; browser microphone page shows real incoming PCM sample count | `tests/capture.test.ts`, `examples/microphone.html` |
| Speaker | Different voices yield `Speaker 1` / `Speaker 2`; per-window speaker turns returned without inventing word alignment | `tests/speaker.test.ts`, `tests/timeline.test.ts` |

The file proof tool requires a canonical **16 kHz mono PCM16 WAV**, with an absolute path **inside the calling Session workspace**. The microphone page needs localhost or HTTPS (getUserMedia) and runs independently of DSH; its Client→Host stream transport is **not yet connected**. This is not advertised as a finished live DSH microphone UI. Both microphone and file inputs are 16 kHz PCM consumers. Context stores `state.json` and audio windows under `DSH_HOME/meeting/sessions/<sessionId>/` as an internal first-stage store, **not a final Markdown schema**.

Speaker models are not bundled. Configure `modelPath` (sherpa-compatible speaker-embedding ONNX) and optionally `segmentationModelPath` (pyannote segmentation ONNX) in the speaker plugin. Without models, labels are unknown and recording still works. When multiple speakers occupy one ASR window, the recognized text is **not** arbitrarily divided between them: the line has no single speaker label and separate timed `turns` describe who spoke when.

## Development and evidence

```sh
corepack enable
pnpm install
pnpm run build
pnpm run typecheck
pnpm test
pnpm proof
# Browser microphone proof after build: serve repo over localhost and open /examples/microphone.html
```

CI owns these checks; initial compatibility with Windows, official Speech and sherpa bindings is assumed, not independently verified. See `docs/milestones.md` for gaps and acceptance.

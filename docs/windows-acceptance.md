# Windows Desktop release acceptance (Issue #7)

This is a **manual release gate**, not part of each PR's focused CI. Run against the built native addon in actual DSH Desktop 0.2.0-rc.2 on Windows x64 with the official Voice Input Bundle and prepared `sensevoice-local` provider. Do not treat the Web-host error RPC, N-API module-load smoke, or mock PCM callbacks as substitutes.

When the native C++ source, CMake configuration or Node ABI target changes, first perform a **clean local Windows build and N-API load check** using the commands in [installation](installation.md). Delete the old `native/build` output before compiling and ensure the module loaded was newly built. Do not treat an existing binary as verification. DSH plugin registration is also checked in the installed local environment, not by a cloud Web workflow.

For each check, record the date, DSH version, plugin HEAD, observed result, and supporting sanitized log or screenshot in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) or the release PR. A successful build without this evidence is **not** an acceptance result.

1. **Start / live transcription:** Create a real DSH Session, prepare SenseVoice, start from the Sidebar, play system audio, and confirm increasing timestamps and readable live transcript. Confirm WAV files and Markdown under that Session's workspace.
2. **Stop / finalization:** Stop from the Sidebar; ensure the last accepted audio reaches the file even with a short trailing fragment. Verify exactly one finalized meeting and actual LLM final summary visible in the right panel.
3. **Ownership and recovery:** Exercise repeated Stop, Session disposal during recording, a new Session after Stop, and an interrupted recording resumed from saved WAV time. Check no stale WASAPI device owner or cross-Session data.
4. **Native queue and discontinuity:** Under observable delayed JS consumption, validate that a native callback overrun is reported and recording stops instead of silently discarding PCM; confirm the final marker is delivered so Stop settles. Verify a normal silent period preserves offsets, and investigate long device-position gaps on actual hardware.
5. **Streaming and model failures:** Confirm `watch` updates without polling manual refresh, transcript/summary tabs remain read-only, an ASR error remains visible while committed WAV survives, and busy Agent deferral eventually produces a final summary once the Agent becomes available.

For any failure, capture the **first accountable dependency edge** (native callback → adapter → Capture → Store → Typert → Sidebar), fix the owner, and add only the smallest discriminating contract test. Keep the physical run here; do not re-create a fake DSH runtime or add these five product journeys to routine CI.

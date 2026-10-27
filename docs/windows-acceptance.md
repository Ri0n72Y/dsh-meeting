# Windows Desktop release acceptance (Issue #7)

This is a **manual release gate**, not part of each PR's focused CI. Run against actual DSH Desktop `0.2.1-rc.3` (the minimum supported release; newer releases need their own evidence) on Windows x64 with the official Voice Input Bundle and prepared `sensevoice-local` provider. Do not treat the Web-host error RPC, N-API module-load smoke, or mock PCM callbacks as substitutes.

First install the **Windows x64 Release `.tgz` asset URL**, not the bare GitHub repository URL. Confirm the release bundle installs and mounts the right Sidebar without Client Loader errors; the bundled `lib/` and prebuilt `native/build/Release/loopback_capture_addon.node` need no install scripts. Then attempt real system audio capture. The native `.node` import smoke on CI is not a substitute for real capture.

When native C++ source, CMake configuration or Node-API target changes, require a **new published Release build** (the release job starts from a clean Windows runner) and Node 22/24 load checks. Verify the installed `.tgz` actually includes that release's binary; do not reuse an old archive. Real DSH plugin registration and system audio remain local Windows acceptance checks.

For each check, record the date, DSH version, plugin HEAD, observed result, and supporting sanitized log or screenshot in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) or the release PR. A successful build without this evidence is **not** an acceptance result.

1. **Start / live transcription:** Create a real DSH Session, prepare SenseVoice, start from the Sidebar, play system audio, and confirm increasing timestamps and readable live transcript. Confirm WAV files and Markdown under that Session's workspace.
2. **Stop / finalization:** Stop from the Sidebar; ensure the last accepted audio reaches the file even with a short trailing fragment. Verify exactly one finalized meeting and actual LLM final summary visible in the right panel.
3. **Ownership and recovery:** Exercise repeated Stop, Session disposal during recording, a new Session after Stop, and an interrupted recording resumed from saved WAV time. Check no stale WASAPI device owner or cross-Session data.
4. **Native queue and discontinuity:** Under observable delayed JS consumption, validate that a native callback overrun is reported and recording stops instead of silently discarding PCM; confirm the final marker is delivered so Stop settles. Verify a normal silent period preserves offsets, and investigate long device-position gaps on actual hardware.
5. **Streaming and model failures:** Confirm `watch` updates without polling manual refresh, transcript/summary tabs remain read-only, an ASR error remains visible while committed WAV survives, and busy Agent deferral eventually produces a final summary once the Agent becomes available.

For any failure, capture the **first accountable dependency edge** (native callback → adapter → Capture → Store → Typert → Sidebar), fix the owner, and add only the smallest discriminating contract test. Keep the physical run here; do not re-create a fake DSH runtime or add these five product journeys to routine CI.

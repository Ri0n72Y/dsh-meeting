# Windows WASAPI source

Based on \`WerdoxDev/loopback-capture\` v3.0.2 (MIT, license included).
Only the Windows native code is built. This copy makes two essential guarantees:

- All WASAPI buffers, including \`AUDCLNT_BUFFERFLAGS_SILENT\`, are sent to the JS consumer as PCM (silence as zeroed frames).
- \`stop()\` queues a **null** callback in the same N-API FIFO after all accepted PCM, before releasing its ThreadSafeFunction. JS awaits that marker and its own durable PCM queue.
- When WASAPI omits packets during output inactivity, valid stream-relative device positions expose the missing 48 kHz frame count. A numeric marker lets JS save the gap as bounded silent PCM blocks. Invalid timestamps are not used to invent missing frames.

Build for Windows x64 with Node 24, MSVC Build Tools, CMake and \`npm install --no-package-lock && npm run build\` inside this directory. The source code is shipped with MeetingCapture; a native build is required before use if no matching compiled binary is bundled.

Upstream version / CMake setup remains intentionally close to 3.0.2 for traceability.

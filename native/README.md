# Windows WASAPI source

Adapted from `WerdoxDev/loopback-capture` v3.0.2 (MIT; included license), preserving silent frames and ordered end-of-callback flush on Stop. Compiles only on Windows x64.

DSH Git installation executes the root `prepare` script after build-script approval. It compiles this addon with Node.js 24, CMake and MSVC Build Tools. Rebuild manually with `npm run native:build` from the repository root if native sources or the Windows build environment change.

The compiled binary is `native/build/Release/loopback_capture_addon.node`. Confirm that the current Desktop can load that binary; TypeScript-focused CI on Linux does not prove native compatibility.

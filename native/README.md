# Windows WASAPI source

Adapted from `WerdoxDev/loopback-capture` v3.0.2 (MIT; included license), preserving silent frames and ordered end-of-callback flush on Stop. The maintained addon builds for Windows x64.

The root plugin does **not** have an install/prepare hook. During a GitHub Release publication, [release-wasapi.yml](../.github/workflows/release-wasapi.yml) compiles the existing addon on a Windows runner and packages it into an installable release `.tgz`. It is not committed to Git and a raw Git URL installation cannot fetch that Release asset automatically.

Maintainers can invoke `npm run native:build` at the repository root on Windows x64 with CMake, MSVC Build Tools and the Windows SDK. The build may fetch the pinned Microsoft WIL source. The output is `native/build/Release/loopback_capture_addon.node`.

The release workflow loads the binary with Node 22, and checks that the npm tarball actually includes it. This verifies the native export and packaging, **not** WASAPI capture on real Windows audio hardware.

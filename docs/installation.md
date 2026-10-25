# Installing dsh-meeting

**Host:** DSH Desktop `0.2.1-rc.3` or later (only `0.2.1-rc.3` is the validated source/build baseline). Older DSH versions are unsupported.

## GitHub installation (recommended)

In **DSH Desktop → Plugins → Install**, enter the repository URL:

```text
https://github.com/Ri0n72Y/dsh-meeting
```

The root `package.json` declares `dsh.bundle.patch`. DSH installs the root bundle and its `cordis.patch.yml`; there is **no** separate `bundles/` package or `packages/*` to install. If the installer displays “This package does not declare a bundle”, check that the Git source is the current repository root, not an older version or an internal directory.

DSH Git installs download **source**, so the root package's `prepare` script builds the Host/Client exports and, on Windows x64, the WASAPI native addon. DSH/pnpm 11 may require explicit **build-script approval**. Approval executes the package's code with the installing user's permissions. Review the source and approve only this repository's intended build script; for reproducibility pin a reviewed Git commit, for example `github:Ri0n72Y/dsh-meeting#<commit>`. Retry the installation after approving the requested build. No build permission is required for an already-built npm tarball.

**Windows prerequisites for native capture:** Node.js 24, CMake, Visual Studio C++ Build Tools (MSVC), connectivity for CMake FetchContent dependencies. Missing prerequisites make the Git `prepare` installation fail; do not misreport that as a successful install. No prebuilt WASAPI binary from upstream is substituted.

The official **DSH Voice Input Bundle** and its `sensevoice-local` provider are independent requirements. Install/enable the official bundle through DSH's plugin manager before attempting live transcription. This project does not ship SenseVoice models or an alternative ASR.

## Local source checkout

For developing or installing from a local checkout:

```powershell
git clone https://github.com/Ri0n72Y/dsh-meeting.git
cd dsh-meeting
pnpm install --frozen-lockfile
pnpm run build
pnpm run native:build
```

In the DSH plugin manager select the **absolute path to the repository root**, or use the DSH CLI with a link to that directory:

```powershell
dsh plugin --profile meeting add "link:C:\\path\\to\\dsh-meeting"
```

The repository `cordis.patch.yml` mounts the four entry points from one npm package:

- `@ri0n72y/dsh-meeting/context` — Session-scoped storage
- `@ri0n72y/dsh-meeting/speaker` — optional local speaker recognition
- `@ri0n72y/dsh-meeting/capture` — persistent WAV capture and official ASR
- `@ri0n72y/dsh-meeting` — Host Meeting Control plus the `./client` right Sidebar

To rebuild the native addon cleanly after a native-source change, delete `native/build`, run `pnpm run native:build`, and verify the binary in `native/build/Release/loopback_capture_addon.node`. Then fully restart Desktop.

## Session storage and acceptance

Recording data stays inside the selected Session Workspace:

```text
<Session Workspace>/.dsh-meeting/<sha256(sessionId)>/state.json
<Session Workspace>/.dsh-meeting/<sha256(sessionId)>/audio/000000.wav
<Session Workspace>/.dsh-meeting/<sha256(sessionId)>/transcript.md
<Session Workspace>/.dsh-meeting/<sha256(sessionId)>/summary.md
```

The Session ID is hashed for safe path names. Existing Session ignore files and symlinks escaping the Workspace are not silently overwritten or followed.

A successful Git installation or lazy-CJS bundle check is **not** a Windows Desktop acceptance result. In [Issue #10](https://github.com/Ri0n72Y/dsh-meeting/issues/10), verify Sidebar boot on a restarted `0.2.1-rc.3` Desktop. Continue the full system-audio → SenseVoice → live transcript → final summary journey in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) following [Windows acceptance](windows-acceptance.md).

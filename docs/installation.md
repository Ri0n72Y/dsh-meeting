# Install dsh-meeting

Requires DSH Desktop **>=0.2.1-rc.3**. Only `0.2.1-rc.3` has been used as the source/build reference; newer versions require their own runtime verification.

## Install from GitHub

In **DSH Desktop → Plugins → Install**, enter:

```text
https://github.com/Ri0n72Y/dsh-meeting
```

This repository root declares `dsh.bundle.patch`, and the **ready-to-load `lib/` directory is committed to Git**. The package no longer runs a `prepare` lifecycle script on installation. Its Host entries are `lib/index.js` (MeetingControl), `lib/context/index.js`, `lib/speaker/index.js`, `lib/capture/index.js`, and its Client lazy-CJS factory is `lib/client/index.js`. The UI can be installed without approving the Meeting package's build scripts. Third-party dependencies may have their own policies and must be assessed separately.

For an immutable install, use `github:Ri0n72Y/dsh-meeting#<reviewed-commit-sha>` rather than a moving branch. Restart DSH Desktop after successful installation.

The **official DSH Voice Input Bundle** and its `sensevoice-local` provider remain separate requirements; this project does not distribute the model.

## Windows WASAPI native setup

**Git installation does not compile a native addon.** This package ships the C++ source but not a Windows `.node` binary. Before using system playback capture on Windows x64, explicitly compile it with Node.js 24, CMake, and MSVC Build Tools.

From an installed Desktop profile, locate the actual package directory:

```powershell
$plugin = Join-Path $HOME '.dsh\profiles\desktop\node_modules\@ri0n72y\dsh-meeting'
if (-not (Test-Path (Join-Path $plugin 'package.json'))) { throw "Meeting package not found at: $plugin" }
Push-Location $plugin
try { npm run native:build } finally { Pop-Location }
```

The expected output is `native/build/Release/loopback_capture_addon.node`. The native build needs network access for the pinned CMake FetchContent dependency. If the pnpm-installed package directory is not writable, compile in a Git checkout and install that checkout via the local `link:` path instead. A bundled prebuilt binary will require a separate reviewed release process; no executable is downloaded silently at first use.

For development or local-link installation:

```powershell
git clone https://github.com/Ri0n72Y/dsh-meeting.git
cd dsh-meeting
pnpm install --frozen-lockfile
pnpm run build
pnpm run check:prebuilt
pnpm run native:build
```

`lib/` is tracked in Git. When source changes alter generated JavaScript or declarations, commit updated `lib/` files as part of the same PR. The focused CI rebuilds them and checks for differences.

## Acceptance boundary

The root `cordis.patch.yml` activates the context, speaker, capture and MeetingControl Host services via one npm package and a `./client` browser entry. WAV recordings and Markdown outputs remain inside the Session Workspace under `.dsh-meeting/<sha256(sessionId)>/`, never inside DSH_HOME.

A successful Git installation or a green build does not demonstrate native audio capture, SenseVoice or final LLM summary. Record the actual Windows `0.2.1-rc.3` results in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) using the [Windows acceptance guide](windows-acceptance.md).

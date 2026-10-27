# Install dsh-meeting

Requires DSH Desktop **>=0.2.1-rc.3** on Windows x64 for WASAPI recording. Only DSH `0.2.1-rc.3` has been used as the source/build reference; newer versions require their own runtime verification.

## Install the release bundle (Windows x64)

After a GitHub Release is published and its Windows workflow succeeds, copy the **direct download URL** of the `dsh-meeting-vX.Y.Z-win32-x64.tgz` attachment on the [Releases page](https://github.com/Ri0n72Y/dsh-meeting/releases). Paste the URL into **DSH Desktop → Plugins → Install**.

The tarball contains the prebuilt Host/Client `lib/` and the compiled `native/build/Release/loopback_capture_addon.node`. No local CMake, MSVC or native npm build scripts are required. Restart DSH Desktop after installation. The matching `.sha256` release attachment provides an integrity checksum; publishing and uploading the assets is a separate release job, so do not assume an asset exists until that job succeeds.

GitHub URL / Git tag installs behave differently:

- `https://github.com/Ri0n72Y/dsh-meeting` installs the default branch's Git tree (currently `main`), **not** the newest GitHub Release.
- `github:Ri0n72Y/dsh-meeting#vX.Y.Z` installs the tag's Git tree, **not** the tag's Release attachments.
- Neither Git installation above includes the release-only native `.node`; these modes need an explicit local native build before system-playback recording.

The official DSH Voice Input Bundle and its `sensevoice-local` provider remain separate requirements; this project does not distribute the model.

## Maintainer: manual build from source

The Git repository keeps the WASAPI C++ source and ready-to-load JavaScript `lib/`; it does not commit compiled `.node` files. For manual development on Windows x64, use a CMake/MSVC/Windows SDK toolchain:

```powershell
git clone https://github.com/Ri0n72Y/dsh-meeting.git
cd dsh-meeting
pnpm install --frozen-lockfile
pnpm run build
pnpm run check:prebuilt
pnpm run native:build
```

The local native build needs network access to the pinned Microsoft WIL source. The output is `native/build/Release/loopback_capture_addon.node`. This manual process is **not** part of the end-user release-tarball installation.

`lib/` remains tracked in Git. Any source modification changing generated JS or declarations must commit the matching `lib/`; CI rebuilds it and checks for differences.

## Acceptance boundary

The root `cordis.patch.yml` activates context, speaker, capture and MeetingControl Host services via one package and a `./client` browser entry. WAV and Markdown outputs remain in the Session Workspace under `.dsh-meeting/<sha256(sessionId)>/`, never in DSH_HOME.

A successful Windows native build, N-API import, Git installation or Web Client boot does **not** demonstrate WASAPI recording, SenseVoice transcription or final LLM summary. Record actual Windows results in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) following the [Windows acceptance guide](windows-acceptance.md).

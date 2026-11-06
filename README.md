# dsh-meeting

DSH **>=0.2.2-rc.1** meeting bundle for Windows Desktop: system-playback recording, official SenseVoice transcription, Sidebar transcript, and periodic/final summaries.

For **Windows x64 system-playback recording**, install the `dsh-meeting-vX.Y.Z-win32-x64.tgz` attachment from a [published GitHub Release](https://github.com/Ri0n72Y/dsh-meeting/releases) in **DSH Desktop → Plugins → Install** (paste the asset's direct URL). The release-only Windows build includes the WASAPI addon and requires no local compiler. This asset exists only after the release workflow succeeds.

The bare [Git repository URL](https://github.com/Ri0n72Y/dsh-meeting) installs the default branch and its committed JavaScript `lib/`, **not** GitHub Release assets; it does not include a Windows native binary.

The repository root is the DSH bundle. Its compiled Host and Client entry points under **`lib/` are committed to Git**; the package has no `prepare`, `install`, or `postinstall` lifecycle script. Git installation therefore does not need to execute this plugin's JavaScript build.

**WASAPI native source is retained in Git**, while Windows x64 `.node` is built only when a Release is published and packaged in that release's installer tarball. The official DSH Voice Input / `sensevoice-local` provider is also required.

Development (Node.js `>=24.9.0`): `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run check:prebuilt`. Source changes that alter runtime output must commit the matching `lib/` files.

See [installation](docs/installation.md), [architecture](docs/architecture.md), [Windows acceptance](docs/windows-acceptance.md) and [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) for actual Desktop verification.

Meeting recording uses configurable 2-second ASR windows (`transcriptionWindowSeconds`, valid range 1–10 seconds). After a normal Stop, `meeting.wav.gz` contains the losslessly compressed full recording (decompress before WAV playback); `transcript.srt` maps each ASR window to its audio range. Original WAV windows remain in place for recovery. SenseVoice does not provide precise sentence-level timestamps.

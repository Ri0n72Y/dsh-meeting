# dsh-meeting

DSH **>=0.2.1-rc.3** meeting bundle for Windows Desktop: system-playback recording, official SenseVoice transcription, Sidebar transcript, and periodic/final summaries.

Install in **DSH Desktop → Plugins → Install** using:

```text
https://github.com/Ri0n72Y/dsh-meeting
```

The repository root is the DSH bundle. Its compiled Host and Client entry points under **`lib/` are committed to Git**; the package has no `prepare`, `install`, or `postinstall` lifecycle script. Git installation therefore does not need to execute this plugin's JavaScript build.

**Windows WASAPI capture is a separate native requirement.** The repository ships audited addon source, but no compiled Windows `.node` binary yet. Build it explicitly on Windows x64 with Node 24, CMake and MSVC Build Tools before starting system audio. The official DSH Voice Input / `sensevoice-local` provider is also required.

Development: `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run check:prebuilt`. Source changes that alter runtime output must commit the matching `lib/` files.

See [installation](docs/installation.md), [architecture](docs/architecture.md), [Windows acceptance](docs/windows-acceptance.md) and [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) for actual Desktop verification.

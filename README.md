# dsh-meeting

DSH **>=0.2.1-rc.3** meeting bundle for Windows Desktop: system-audio recording, official SenseVoice transcription, a right Sidebar transcript, and periodic/final LLM summaries.

Install in **DSH Desktop → Plugins → Install** using the repository URL:

```text
https://github.com/Ri0n72Y/dsh-meeting
```

The repository root **is the DSH bundle** (`package.json` → `dsh.bundle.patch` → `cordis.patch.yml`). Git installations run the package's `prepare` build, including a Windows WASAPI addon build. Approve only the build scripts you trust; Node.js 24, CMake and MSVC Build Tools are required on Windows. The official Voice Input / `sensevoice-local` provider must also be enabled.

The four Cordis capabilities (`context`, `speaker`, `capture`, root UI) remain independent plugin entries within one installable npm package. Audio and Markdown are stored in each Session Workspace.

For detailed [installation requirements](docs/installation.md) and the [Windows acceptance procedure](docs/windows-acceptance.md), see the linked guides. Focused CI checks source, build and the generated Client registration; it **does not** prove Desktop recording or model readiness. [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7) tracks real-device acceptance.

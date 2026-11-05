# DSH root bundle with committed library output

The repository root is one installable `@ri0n72y/dsh-meeting` package. Its `package.json` declares `dsh.bundle.patch`; `cordis.patch.yml` inserts four independent Cordis Host services. There are no `workspace:*` production dependencies.

Host entrypoints: `lib/index.js` (MeetingControl), `lib/context/index.js`, `lib/speaker/index.js` and `lib/capture/index.js`. Declarations are emitted beside those files. The browser Client entrypoint is `lib/client/index.js`, a classic-script lazy-CJS factory registered under the root package's module ID, with React/Cordis/DSH UI modules externalized to the Client module table.

The `lib/` tree is **built during development/CI and committed in Git**. This is a distribution choice for pnpm 11 Git installation without lifecycle-script authorization: the package intentionally has no `prepare`, `prepack`, `install`, or `postinstall` hook. CI rebuilds the artifacts and rejects discrepancies between generated output and tracked `lib/` files. The `check:install` script inspects the actual npm pack inventory and the absence of those hooks.

The DSH official internal packages generally emit `lib/` and use explicit package exports; their docs do not mandate committing generated output in every project. We commit it specifically to support the GitHub URL installation flow without a build approval button.

**Native boundary:** the `native/` C++ WASAPI source is included in Git, but its compiled Windows x64 `.node` binary remains Git-ignored. Publishing a GitHub Release triggers a separate Windows workflow that builds the N-API addon, validates Node 22 loading, and attaches an installable npm `.tgz` containing `lib/` and `native/build/Release/loopback_capture_addon.node` with a SHA-256 checksum. Installing the tarball URL requires no user-side native toolchain. Raw Git URLs and Git tags still install their Git trees and **do not** include the Release attachment. The script-free installer never fetches an additional executable at startup.

The target is DSH `>=0.2.1-rc.3`, with automated focused testing against rc.3 source/build contracts. A real DSH Desktop Release-tarball installation, Sidebar registration, native capture, official SenseVoice and LLM summary remain manual checks under [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7).

## Recording granularity and final audio

MeetingControl passes the configurable `transcriptionWindowSeconds` (default 2; whole seconds from 1 to 10) to Capture. Recording offsets follow persisted PCM sample counts, including interrupted-session resume.

After a normal Stop, all accepted PCM windows become one losslessly compressed `meeting.wav.gz` inside the Session directory. Uncompress it to get a standard, playable 16 kHz mono WAV. The archive keeps silence and exact sample offsets, uses atomic publication, and does not require FFmpeg. Source WAV windows remain available for recovery; compression failure never deletes them.

The readable `transcript.md` remains grouped into paragraphs. The adjacent `transcript.srt` contains millisecond-formatted start/end times for each original ASR window, matching the full recording. This is window-level timing, not exact sentence-level forced alignment. The official DSH SenseVoice Transcript interface has no timed tokens; precise sentence timing requires a separate timing-capable recognizer or aligner.

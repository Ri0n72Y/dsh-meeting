# DSH root bundle with committed library output

The repository root is one installable `@ri0n72y/dsh-meeting` package. Its `package.json` declares `dsh.bundle.patch`; `cordis.patch.yml` inserts four independent Cordis Host services. There are no `workspace:*` production dependencies.

Host entrypoints: `lib/index.js` (MeetingControl), `lib/context/index.js`, `lib/speaker/index.js` and `lib/capture/index.js`. Declarations are emitted beside those files. The browser Client entrypoint is `lib/client/index.js`, a classic-script lazy-CJS factory registered under the root package's module ID, with React/Cordis/DSH UI modules externalized to the Client module table.

The `lib/` tree is **built during development/CI and committed in Git**. This is a distribution choice for pnpm 11 Git installation without lifecycle-script authorization: the package intentionally has no `prepare`, `prepack`, `install`, or `postinstall` hook. CI rebuilds the artifacts and rejects discrepancies between generated output and tracked `lib/` files. The `check:install` script inspects the actual npm pack inventory and the absence of those hooks.

The DSH official internal packages generally emit `lib/` and use explicit package exports; their docs do not mandate committing generated output in every project. We commit it specifically to support the GitHub URL installation flow without a build approval button.

**Native boundary:** the `native/` C++ WASAPI source is included; a compiled Windows x64 `.node` binary is **not yet** shipped. The installer is intentionally script-free; users must explicitly build the native addon before recording. This is not equivalent to an end-to-end functional installation. A future prebuilt-native distribution should verify its binary provenance and Node-API compatibility, and must not silently fetch or execute unreviewed code.

The target is DSH `>=0.2.1-rc.3`, with automated focused testing against rc.3 source/build contracts. A real DSH Desktop Git installation, Sidebar registration, native capture, official SenseVoice and LLM summary remain manual checks under [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7).

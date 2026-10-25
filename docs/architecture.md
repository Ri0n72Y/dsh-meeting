# Root DSH bundle and independent Cordis services

The repository root is one installable DSH bundle, matching the official `dsh.bundle.patch` contract. A Git URL resolves to this package's root `package.json`, which declares the `./cordis.patch.yml` layer.

Four Host plugin entry points remain separate Cordis services: `./context`, `./speaker`, `./capture`, and the package root (Meeting Control). The same root package declares its `./client` entry for the right Sidebar. The package's source is organized under `src/<capability>/`; built artifacts are under `dist/<capability>/index.js`. This preserves boundaries without multiple `workspace:*` runtime packages, which cannot be installed independently from one Git source.

All Context extensions share one TypeScript source identity during development via `tsconfig.json` path mappings. Host cross-capability imports use only public self-package subpaths and remain **external** at build time to avoid duplicating service instances. Client code is a separate DSH lazy-CJS factory; React and shared UI primitives are resolved from DSH's browser module table. It is registered under the package's bare name so the Host's root Loader row owns its lifecycle.

The root `prepare` script makes a Git source installation self-building. On Windows x64 it also compiles `native/` from pinned WASAPI source; other platforms skip the Windows-only addon. Native build permission and toolchain prerequisites are explicit. Only `dist/**`, the bundle patch and required native sources/artifacts ship in the installed npm package.

The baseline is DSH `>=0.2.1-rc.3`, with source/build verification against `0.2.1-rc.3`. Runtime Windows Desktop acceptance remains manual in [Issue #7](https://github.com/Ri0n72Y/dsh-meeting/issues/7), not inferred from unit tests.

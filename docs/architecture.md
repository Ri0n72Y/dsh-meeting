# Multi-package TypeScript contract

Based on the proven multi-plugin layout in [dsh-mindppt](https://github.com/Ri0n72Y/dsh-mindppt), not a one-off TS2717 suppression.

## One plugin = one compilation scope

Each Cordis service package owns `src` and `tsconfig.json`, extends a shared `tsconfig.base.json`, and has its own `typecheck` script. The repository's top-level typecheck runs every plugin plus the tests. No source file is manually excluded, and `skipLibCheck` is **not** used to conceal conflicts in our source.

## Keep one Context augmentation identity

Cordis `declare module '@deepseek-ai/cordis'` extends the same Context across independently loaded services. Each workspace package exports both `development: ./src/index.ts` and release `types/default: ./dist/index.d.ts/js`. TypeScript uses `customConditions: ['development']` so all workspace references during development resolve to **one source identity**, never a mixture of source classes and their generated declarations. Release consumers see only the built artifacts.

Do not solve TS2717 by deleting Context augmentations, widening services to `any`, or suppressing compiler diagnostics.

## Verification boundaries

Automated CI performs one source typecheck, focused contract tests and one build. Native C++ changes require a clean local Windows build and N-API load check; DSH profile/registration is verified during manual deployment. Desktop playback, SenseVoice and LLM remain release acceptance, not CI claims; see [testing contracts](testing-contracts.md) and [Windows acceptance](windows-acceptance.md).

## Package dependency versions

This is a third-party monorepo, not DSH's own source workspace. Use independently published versions:
- `@deepseek-ai/cordis@4.0.4` (not `0.2.0-rc.2`)
- `@deepseek-ai/schemastery@3.18.4`
- DSH packages such as `@deepseek-ai/dsh-tools@0.2.0-rc.2`.

Keep capability-to-capability boundaries in `peerDependencies: workspace:*`, use type-only imports for cross-plugin Context augmentations, and do not import another plugin's private implementation path from production code.

The previous root-wide `tsc --noEmit` compiled *every* `packages/**/src` file while separately loading compiled `dist` declarations for package specifiers. Since Service classes carry different module identities, their Cordis Context merge failed with TS2717 despite printing apparently identical class names. The above contract addresses the identity mismatch rather than masking it.

MeetingControl and the Sidebar are separate UI capabilities; test ownership follows each actual component boundary rather than duplicating multi-plugin flow simulations.

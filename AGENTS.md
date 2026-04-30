# Repository Guidelines

## Project Structure & Module Organization

This package is a TypeScript ESM library for Better Auth + OpenMeter integrations.

- `src/`: library source
  - `src/catalog/`: billing catalog DSL, validation, and compilation
  - `src/adapters/`: provider bridges and runtime helpers (`stripe`, `razorpay`, `dodo`, `billing`, etc.)
  - `src/index.ts`, `src/client.ts`, `src/react.ts`: public entrypoints
- `test/`: Vitest unit tests mirroring the source layout (`catalog.test.ts`, `adapters-*.test.ts`)
- `.github/workflows/`: CI and publish automation
- `README.md`: install, usage, and public API examples

## Build, Test, and Development Commands

- `npm run typecheck`: run TypeScript checks with `tsc --noEmit`
- `npm test`: run the full Vitest suite
- `npm run build`: build ESM bundles and `.d.ts` files with `tsup`
- `npm pack --dry-run`: verify published package contents before release

Typical local verification:

```sh
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Coding Style & Naming Conventions

- Use TypeScript with existing ESM import/export patterns.
- Follow the current formatting style: 2-space indentation, semicolons, and explicit exported types.
- Prefer small, focused helpers over large inline branches.
- Use `camelCase` for variables/functions, `PascalCase` for exported types, and descriptive filenames such as `adapters-billing.test.ts`.
- Keep public API names aligned with repository terminology: `plans`, `addons`, `topups`, `entitlements`, `grants`.

## Testing Guidelines

- Tests use **Vitest** and live under `test/`.
- Add or update tests for every public API or validation rule change.
- Name tests by behavior, e.g. `it("can apply a catalog topup grant")`.
- Keep tests close to the feature area they validate: catalog logic in `test/catalog.test.ts`, adapter behavior in `test/adapters-*.test.ts`.

## Commit & Pull Request Guidelines

- Follow the existing commit style: short, imperative summaries such as `Add catalog topup runtime helper`.
- Keep commits logically grouped; separate implementation from docs/tests when practical.
- PRs should include:
  - a concise summary of behavior changes
  - test evidence (`typecheck`, `test`, `build`, `pack`)
  - README updates when public APIs or workflows change

## Release & Configuration Notes

- `main` is protected; merge through PRs.
- Do not commit secrets. npm publishing may require 2FA or the configured GitHub publish workflow.

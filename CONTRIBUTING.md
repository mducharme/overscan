# Contributing

To add a new node:

1. Implement the node in `packages/nodes/src`.
2. Export it from `packages/nodes/src/index.ts` and `packages/nodes/src/browser.ts` when browser-safe.
3. Register the `impl` string in the shared registry.
4. Add or update an example scene.
5. Add focused tests when the node is stateful, error-prone, or runtime-specific.
6. Verify with `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm validate-examples` (CI validates every `*.scene.json` / `*.demo.json` under `examples/`).

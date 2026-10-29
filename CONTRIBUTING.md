# Contributing

To add a new node:

1. Implement the node in `packages/nodes/src`.
2. Export it from `packages/nodes/src/index.ts` and `packages/nodes/src/browser.ts` when browser-safe.
3. Register the `impl` string in the shared registry.
4. Add or update an example scene.
5. Add focused tests when the node is stateful, error-prone, or runtime-specific.
6. Verify with `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm validate-examples` (CI validates every `*.scene.json` / `*.demo.json` under `examples/`).

Performance: `pnpm bench` renders every built-in effect (in isolation), every example scene, and every example demo on the CPU path and reports median / p95 frame times with per-node hotspots. Record a baseline before optimizing and compare after:

```sh
pnpm build && pnpm bench --save bench-results/before.json
# ...change code, pnpm build...
pnpm bench --baseline bench-results/before.json   # Δ per bench; `*` = output pixels changed
```

Use `--suite effects|scenes|demos`, `--filter <name>`, `--frames`, `--repeat`. Output hashes are deterministic (`Math.random` is seeded), so a `*` means a real visual change.

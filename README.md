# Overscan

> Audiovisual effects in your terminal, written in TypeScript. Open the same scene in the browser when you want a bigger canvas—not the other way around.

Walkthroughs and the node index: **[docs/EXAMPLES.md](docs/EXAMPLES.md)**.

JSON node graphs in TypeScript: frames to the terminal (sixel, ANSI half-blocks, ASCII), **Overscan Studio** in the browser when you want it. **Inspired by** demoscene culture, not a stand-in for it—familiar tooling for people who liked that look. **No assembly required** (every sense).

## Try it

Node 20+, pnpm 9+, from repo root:

```bash
pnpm install && pnpm build
pnpm run overscan -- run examples/generators/twister.scene.json
```

That should fill the terminal with a twister. Browser: `pnpm run overscan -- dev examples/generators/plasma.scene.json` — run `run` and `dev` side by side if you want terminal + canvas.

## What it looks like

**ANSI** uses half-block characters for colour; **sixel** is nearer to pixels where the terminal allows; **ASCII** uses shaded glyphs (truecolour when available). **Terminal first:** `overscan run` in one pane, `overscan dev` on the same file in another for low-res glow next to Studio or a canvas.

Scenes are JSON: nodes, edges, and an output pointing at what feeds the terminal (or export). Minimal shape:

```json
{
  "id": "hello",
  "duration": 30,
  "resolution": { "width": 640, "height": 360 },
  "fps": 30,
  "tracks": [],
  "graph": {
    "nodes": [
      { "id": "p", "type": "generator", "impl": "plasma", "config": { "speed": 1 } }
    ],
    "edges": [],
    "outputs": { "terminal": "p" }
  }
}
```

Numbers can be literals, timeline keys (Rocket-style), or signal-node outputs—one file stays authoritative. Generators draw, modifiers transform one buffer, compositors merge, signals feed numbers; the same graph runs in the terminal, browser, and export.

## Packages


| Package                   | Role                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `@overscan/types`         | Shared TypeScript types                                         |
| `@overscan/core`          | Graph execution, buffers, timeline, scene loading               |
| `@overscan/nodes`         | Generators, modifiers, compositors, signals                     |
| `@overscan/sink-terminal` | Sixel, ANSI, ASCII output                                       |
| `@overscan/sink-browser`  | Browser / WebGL sinks                                           |
| `@overscan/sink-export`   | PNG sequences, MP4/GIF, terminal raster export                  |
| `@overscan/cli`           | `overscan` command (`run`, `dev`, `export`, `validate`, `init`) |
| `@overscan/sequencer`     | Multi-section demo types                                        |
| `@overscan/text`          | Shared text helpers for text-oriented nodes                     |
| `@overscan/studio`        | Browser Studio (preview, editing, timeline UI)                  |


## License

MIT
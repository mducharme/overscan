# Examples gallery

Single-scene **generators** live under [`examples/generators/`](../examples/generators/); **advanced** multi-node graphs under [`examples/advanced/`](../examples/advanced/). Each section matches a `*.scene.json` basename.

**Animated GIF previews** are stored under `docs/examples/` (next to this file):

- `docs/examples/generators/{name}-terminal.gif` — terminal raster export (80×24, ANSI half-block)
- `docs/examples/generators/{name}-ascii.gif` — ASCII raster at **160×48** character cells (2× the ANSI grid), then **scaled to 640×384** to match the ANSI GIF (`export-example-gifs` uses Lanczos + palette)
- `docs/examples/generators/{name}-webgl.gif` — headless WebGL blit + palette GIF

The same pattern applies in `docs/examples/advanced/`.

**Image paths in this document are relative to `docs/EXAMPLES.md`** (e.g. `examples/generators/plasma-terminal.gif`, `…-ascii.gif`, `…-webgl.gif`). They render in GitHub, VS Code Markdown Preview, and most static site generators **after** you generate the files:

```bash
pnpm build
pnpm export-example-gifs
```

Full option tables for every `impl` are in [`EFFECTS.md`](EFFECTS.md). JSON blocks below are **this repo’s example `config`** only.

---

## Contents

- [Generator examples](#generator-examples)
- [Advanced compositions](#advanced-compositions)
- [See also](#see-also)

---

## Generator examples

| Impl | Description |
| --- | --- |
| `checkerboard-floor` | Perspective checker ground, sky, fog, scroll |
| `copperbars` | Horizontal colour bars (Amiga-style copper) |
| `dot-matrix` | Point grids / paths (e.g. helix) |
| `fire` | 2D heat simulation (stateful) |
| `fractal-zoom` | Mandelbrot / Julia zoom |
| `game-of-life` | Cellular automaton on a grid |
| `glenz` | Stacked transparent shaded shapes |
| `lasers` | Beams from emitters, sweep and glow |
| `lissajous` | Parametric curves, trail, glow |
| `matrix-rain` | Falling glyph columns |
| `metaballs` | 2D metaball field |
| `moire` | Interference patterns |
| `oscilloscope` | Faux scope trace + grid |
| `plasma` | Summed waves + palette |
| `raymarcher` | SDF ray marching (inline or `scenePath` GLSL) |
| `rotozoom` | Rotate + zoom texture |
| `scroller` | Horizontal text + sine warp |
| `shadebobs` | Shaded blobs + palette |
| `sinebobs` | Circles on sine paths |
| `starfield` | 3D star motion |
| `text` | Positioned text + font |
| `tunnel` | Cylindrical tunnel |
| `twister` | Vertical sine “twister” bars |
| `vector-balls` | 3D balls (defaults in node) |
| `voxel-landscape` | Heightfield voxels |
| `water-ripple` | Ripple sim + refraction look |
| `wireframe` | 3D wire mesh |

### Checkerboard Floor

**Scene:** [`examples/generators/checkerboard-floor.scene.json`](../examples/generators/checkerboard-floor.scene.json)

```json
{
  "color1": "#ffe59b",
  "color2": "#0c1430",
  "fogColor": "#08111f",
  "skyColor": "#050814",
  "horizon": 0.42,
  "scrollSpeed": 0.2,
  "rotationSpeed": 0.12
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![checkerboard-floor terminal](examples/generators/checkerboard-floor-terminal.gif) | ![checkerboard-floor ascii](examples/generators/checkerboard-floor-ascii.gif) | ![checkerboard-floor webgl](examples/generators/checkerboard-floor-webgl.gif) |

### Copperbars

**Scene:** [`examples/generators/copperbars.scene.json`](../examples/generators/copperbars.scene.json)

```json
{ "speed": 1.2, "count": 18 }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![copperbars terminal](examples/generators/copperbars-terminal.gif) | ![copperbars ascii](examples/generators/copperbars-ascii.gif) | ![copperbars webgl](examples/generators/copperbars-webgl.gif) |

### Dot Matrix

**Scene:** [`examples/generators/dot-matrix.scene.json`](../examples/generators/dot-matrix.scene.json)

```json
{ "shape": "helix", "count": 1800, "pointSize": 2.5 }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![dot-matrix terminal](examples/generators/dot-matrix-terminal.gif) | ![dot-matrix ascii](examples/generators/dot-matrix-ascii.gif) | ![dot-matrix webgl](examples/generators/dot-matrix-webgl.gif) |

### Fire

**Scene:** [`examples/generators/fire.scene.json`](../examples/generators/fire.scene.json)

```json
{ "cooling": 0.09, "seed": "noise", "seedIntensity": 1.1 }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![fire terminal](examples/generators/fire-terminal.gif) | ![fire ascii](examples/generators/fire-ascii.gif) | ![fire webgl](examples/generators/fire-webgl.gif) |

### Fractal Zoom

**Scene:** [`examples/generators/fractal-zoom.scene.json`](../examples/generators/fractal-zoom.scene.json)

```json
{
  "type": "mandelbrot",
  "zoom": 1.1,
  "zoomSpeed": 0.06,
  "maxIter": 80,
  "smooth": true
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![fractal-zoom terminal](examples/generators/fractal-zoom-terminal.gif) | ![fractal-zoom ascii](examples/generators/fractal-zoom-ascii.gif) | ![fractal-zoom webgl](examples/generators/fractal-zoom-webgl.gif) |

### Game of Life

**Scene:** [`examples/generators/game-of-life.scene.json`](../examples/generators/game-of-life.scene.json)

```json
{
  "seed": "random",
  "seedDensity": 0.28,
  "scale": 4,
  "speed": 2,
  "colorMode": "age",
  "agePalette": [[8, 10, 18], [0, 180, 100], [255, 255, 255]]
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![game-of-life terminal](examples/generators/game-of-life-terminal.gif) | ![game-of-life ascii](examples/generators/game-of-life-ascii.gif) | ![game-of-life webgl](examples/generators/game-of-life-webgl.gif) |

### Glenz

**Scene:** [`examples/generators/glenz.scene.json`](../examples/generators/glenz.scene.json)

```json
{ "backgroundColor": "#04060e", "alpha": 0.36 }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![glenz terminal](./examples/generators/glenz-terminal.gif) | ![glenz ascii](./examples/generators/glenz-ascii.gif) | ![glenz webgl](./examples/generators/glenz-webgl.gif) |

### Lasers

**Scene:** [`examples/generators/lasers.scene.json`](../examples/generators/lasers.scene.json)

```json
{
  "beamCount": 20,
  "emitterCount": 4,
  "spread": 1.8,
  "sweepSpeed": 1.1,
  "rotationSpeed": 0.55,
  "beamWidth": 2.4,
  "glowWidth": 20,
  "backgroundColor": "#020409"
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![lasers terminal](examples/generators/lasers-terminal.gif) | ![lasers ascii](examples/generators/lasers-ascii.gif) | ![lasers webgl](examples/generators/lasers-webgl.gif) |

### Lissajous

**Scene:** [`examples/generators/lissajous.scene.json`](../examples/generators/lissajous.scene.json)

```json
{
  "a": 3,
  "b": 2,
  "delta": 1.57,
  "amplitude": 0.82,
  "trailLength": 680,
  "decay": 0.95,
  "color": "#68ffca",
  "lineWidth": 1.5,
  "glow": 0.5
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![lissajous terminal](examples/generators/lissajous-terminal.gif) | ![lissajous ascii](examples/generators/lissajous-ascii.gif) | ![lissajous webgl](examples/generators/lissajous-webgl.gif) |

### Matrix Rain

**Scene:** [`examples/generators/matrix-rain.scene.json`](../examples/generators/matrix-rain.scene.json)

```json
{
  "charset": "katakana",
  "speed": 1,
  "density": 0.65,
  "trailLength": 0.32,
  "fontSize": 15
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![matrix-rain terminal](examples/generators/matrix-rain-terminal.gif) | ![matrix-rain ascii](examples/generators/matrix-rain-ascii.gif) | ![matrix-rain webgl](examples/generators/matrix-rain-webgl.gif) |

### Metaballs

**Scene:** [`examples/generators/metaballs.scene.json`](../examples/generators/metaballs.scene.json)

```json
{
  "count": 6,
  "threshold": 0.46,
  "speed": 1,
  "glow": 0.8,
  "palette": [[6, 255, 210], [0, 148, 255], [186, 48, 255], [255, 78, 152], [255, 242, 92]]
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![metaballs terminal](examples/generators/metaballs-terminal.gif) | ![metaballs ascii](examples/generators/metaballs-ascii.gif) | ![metaballs webgl](examples/generators/metaballs-webgl.gif) |

### Moiré

**Scene:** [`examples/generators/moire.scene.json`](../examples/generators/moire.scene.json)

```json
{
  "mode": "radial",
  "freq1": 14,
  "freq2": 15.5,
  "speed1": 0.5,
  "speed2": -0.35,
  "contrast": 1.5,
  "palette": [[0, 0, 0], [80, 20, 120], [255, 100, 200], [255, 255, 255]]
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![moire terminal](examples/generators/moire-terminal.gif) | ![moire ascii](examples/generators/moire-ascii.gif) | ![moire webgl](examples/generators/moire-webgl.gif) |

### Oscilloscope

**Scene:** [`examples/generators/oscilloscope.scene.json`](../examples/generators/oscilloscope.scene.json)

```json
{
  "color": "#5dffc8",
  "lineWidth": 2,
  "timeScale": 1.1,
  "voltScale": 1,
  "gridDivisions": 8
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![oscilloscope terminal](examples/generators/oscilloscope-terminal.gif) | ![oscilloscope ascii](examples/generators/oscilloscope-ascii.gif) | ![oscilloscope webgl](examples/generators/oscilloscope-webgl.gif) |

### Plasma

**Scene:** [`examples/generators/plasma.scene.json`](../examples/generators/plasma.scene.json)

```json
{
  "speed": 0.85,
  "scale": 1.7,
  "palette": [[14, 10, 42], [64, 28, 126], [0, 176, 255], [255, 104, 196], [255, 240, 116]]
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![plasma terminal](examples/generators/plasma-terminal.gif) | ![plasma ascii](examples/generators/plasma-ascii.gif) | ![plasma webgl](examples/generators/plasma-webgl.gif) |

### Raymarcher (sphere)

**Scene:** [`examples/generators/raymarcher.scene.json`](../examples/generators/raymarcher.scene.json)

```json
{
  "fogColor": "#050a14",
  "cameraPos": [0, 0, 3],
  "scene": "return sdSphere(p, 0.85);"
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![raymarcher terminal](examples/generators/raymarcher-terminal.gif) | ![raymarcher ascii](examples/generators/raymarcher-ascii.gif) | ![raymarcher webgl](examples/generators/raymarcher-webgl.gif) |

### Raymarcher Monument

**Scene:** [`examples/generators/raymarcher-monument.scene.json`](../examples/generators/raymarcher-monument.scene.json)

```json
{
  "fogColor": "#02050b",
  "cameraPos": [0, 0.25, 3.4],
  "scenePath": "../../shaders/raymarcher-monument.glsl"
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![raymarcher-monument terminal](examples/generators/raymarcher-monument-terminal.gif) | ![raymarcher-monument ascii](examples/generators/raymarcher-monument-ascii.gif) | ![raymarcher-monument webgl](examples/generators/raymarcher-monument-webgl.gif) |

### Rotozoom

**Scene:** [`examples/generators/rotozoom.scene.json`](../examples/generators/rotozoom.scene.json)

```json
{ "rotationSpeed": 0.9, "zoomSpeed": 0.45, "zoomRange": [0.55, 1.85] }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![rotozoom terminal](examples/generators/rotozoom-terminal.gif) | ![rotozoom ascii](examples/generators/rotozoom-ascii.gif) | ![rotozoom webgl](examples/generators/rotozoom-webgl.gif) |

### Scroller

**Scene:** [`examples/generators/scroller.scene.json`](../examples/generators/scroller.scene.json)

```json
{
  "text": "  >>> OVERSCAN SCROLLER  >>>  ",
  "fontSize": 26,
  "speed": 32,
  "waveAmplitude": 4,
  "waveFrequency": 0.12
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![scroller terminal](examples/generators/scroller-terminal.gif) | ![scroller ascii](examples/generators/scroller-ascii.gif) | ![scroller webgl](examples/generators/scroller-webgl.gif) |

### Shadebobs

**Scene:** [`examples/generators/shadebobs.scene.json`](../examples/generators/shadebobs.scene.json)

```json
{
  "count": 9,
  "radius": 30,
  "speed": 1.2,
  "palette": [[24, 20, 56], [96, 46, 172], [255, 84, 180], [255, 226, 108]]
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![shadebobs terminal](examples/generators/shadebobs-terminal.gif) | ![shadebobs ascii](examples/generators/shadebobs-ascii.gif) | ![shadebobs webgl](examples/generators/shadebobs-webgl.gif) |

### Sinebobs

**Scene:** [`examples/generators/sinebobs.scene.json`](../examples/generators/sinebobs.scene.json)

```json
{ "count": 18, "radius": 22, "freqX": 1.1, "freqY": 1.35, "amplitude": 0.42 }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![sinebobs terminal](examples/generators/sinebobs-terminal.gif) | ![sinebobs ascii](examples/generators/sinebobs-ascii.gif) | ![sinebobs webgl](examples/generators/sinebobs-webgl.gif) |

### Starfield

**Scene:** [`examples/generators/starfield.scene.json`](../examples/generators/starfield.scene.json)

```json
{ "count": 260, "warpSpeed": 1.15, "starColor": [230, 244, 255] }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![starfield terminal](examples/generators/starfield-terminal.gif) | ![starfield ascii](examples/generators/starfield-ascii.gif) | ![starfield webgl](examples/generators/starfield-webgl.gif) |

### Text

**Scene:** [`examples/generators/text.scene.json`](../examples/generators/text.scene.json)

```json
{
  "text": "OVERSCAN",
  "font": "overscan://fonts/Press2P",
  "fontSize": 42,
  "align": "center",
  "x": 0.5,
  "y": 0.5,
  "color": "#f4f7ff"
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![text terminal](examples/generators/text-terminal.gif) | ![text ascii](examples/generators/text-ascii.gif) | ![text webgl](examples/generators/text-webgl.gif) |

### Tunnel

**Scene:** [`examples/generators/tunnel.scene.json`](../examples/generators/tunnel.scene.json)

```json
{ "speed": 1.8, "twist": 0.12, "fog": 0.35, "zoom": 1.05 }
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![tunnel terminal](examples/generators/tunnel-terminal.gif) | ![tunnel ascii](examples/generators/tunnel-ascii.gif) | ![tunnel webgl](examples/generators/tunnel-webgl.gif) |

### Twister

**Scene:** [`examples/generators/twister.scene.json`](../examples/generators/twister.scene.json)

```json
{
  "twistSpeed": 1.8,
  "verticalFrequency": 1.45,
  "width": 0.28,
  "sway": 0.12,
  "shading": 0.82,
  "backgroundColor": "#050812",
  "palette": [[255, 78, 150], [255, 208, 72], [90, 246, 168], [82, 164, 255]]
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![twister terminal](examples/generators/twister-terminal.gif) | ![twister ascii](examples/generators/twister-ascii.gif) | ![twister webgl](examples/generators/twister-webgl.gif) |

### Vector Balls

**Scene:** [`examples/generators/vector-balls.scene.json`](../examples/generators/vector-balls.scene.json)

```json
{}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![vector-balls terminal](examples/generators/vector-balls-terminal.gif) | ![vector-balls ascii](examples/generators/vector-balls-ascii.gif) | ![vector-balls webgl](examples/generators/vector-balls-webgl.gif) |

### Voxel Landscape

**Scene:** [`examples/generators/voxel-landscape.scene.json`](../examples/generators/voxel-landscape.scene.json)

```json
{}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![voxel-landscape terminal](examples/generators/voxel-landscape-terminal.gif) | ![voxel-landscape ascii](examples/generators/voxel-landscape-ascii.gif) | ![voxel-landscape webgl](examples/generators/voxel-landscape-webgl.gif) |

### Water Ripple

**Scene:** [`examples/generators/water-ripple.scene.json`](../examples/generators/water-ripple.scene.json)

```json
{
  "damping": 0.99,
  "tapMode": "random",
  "tapRate": 2.2,
  "tapStrength": 0.85,
  "refraction": 0.38
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![water-ripple terminal](examples/generators/water-ripple-terminal.gif) | ![water-ripple ascii](examples/generators/water-ripple-ascii.gif) | ![water-ripple webgl](examples/generators/water-ripple-webgl.gif) |

### Wireframe

**Scene:** [`examples/generators/wireframe.scene.json`](../examples/generators/wireframe.scene.json)

```json
{
  "color": "#88f8ff",
  "backgroundColor": "#04070f",
  "lineWidth": 2.4,
  "scale": 1.1
}
```

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![wireframe terminal](examples/generators/wireframe-terminal.gif) | ![wireframe ascii](examples/generators/wireframe-ascii.gif) | ![wireframe webgl](examples/generators/wireframe-webgl.gif) |

---

## Advanced compositions

Pipeline summaries; full graphs are in each linked `*.scene.json`.

### Blur Glow Stack

Metaballs + text → screen-blend → blur-glow → glow → crt.

**Scene:** [`examples/advanced/blur-glow-stack.scene.json`](../examples/advanced/blur-glow-stack.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![blur-glow-stack terminal](examples/advanced/blur-glow-stack-terminal.gif) | ![blur-glow-stack ascii](examples/advanced/blur-glow-stack-ascii.gif) | ![blur-glow-stack webgl](examples/advanced/blur-glow-stack-webgl.gif) |

### Cells Matrix Scope

Game of life + matrix rain (screen) + oscilloscope (additive) → color-grade → crt.

**Scene:** [`examples/advanced/cells-matrix-scope.scene.json`](../examples/advanced/cells-matrix-scope.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![cells-matrix-scope terminal](examples/advanced/cells-matrix-scope-terminal.gif) | ![cells-matrix-scope ascii](examples/advanced/cells-matrix-scope-ascii.gif) | ![cells-matrix-scope webgl](examples/advanced/cells-matrix-scope-webgl.gif) |

### Copper Sinebobs

Copperbars + sinebobs → screen-blend.

**Scene:** [`examples/advanced/copper-sinebobs.scene.json`](../examples/advanced/copper-sinebobs.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![copper-sinebobs terminal](examples/advanced/copper-sinebobs-terminal.gif) | ![copper-sinebobs ascii](examples/advanced/copper-sinebobs-ascii.gif) | ![copper-sinebobs webgl](examples/advanced/copper-sinebobs-webgl.gif) |

### Fire Scroller

Fire + scroller → additive-blend.

**Scene:** [`examples/advanced/fire-scroller.scene.json`](../examples/advanced/fire-scroller.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![fire-scroller terminal](examples/advanced/fire-scroller-terminal.gif) | ![fire-scroller ascii](examples/advanced/fire-scroller-ascii.gif) | ![fire-scroller webgl](examples/advanced/fire-scroller-webgl.gif) |

### Floor Metaballs

Checkerboard floor + metaballs → screen-blend → glow → crt.

**Scene:** [`examples/advanced/floor-metaballs.scene.json`](../examples/advanced/floor-metaballs.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![floor-metaballs terminal](examples/advanced/floor-metaballs-terminal.gif) | ![floor-metaballs ascii](examples/advanced/floor-metaballs-ascii.gif) | ![floor-metaballs webgl](examples/advanced/floor-metaballs-webgl.gif) |

### Fractal Floor

Fractal zoom + checkerboard floor → overlay-blend → lens → crt.

**Scene:** [`examples/advanced/fractal-floor.scene.json`](../examples/advanced/fractal-floor.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![fractal-floor terminal](examples/advanced/fractal-floor-terminal.gif) | ![fractal-floor ascii](examples/advanced/fractal-floor-ascii.gif) | ![fractal-floor webgl](examples/advanced/fractal-floor-webgl.gif) |

### Moiré Mirror Cycle

Moire → mirror (octal) → palette-cycle.

**Scene:** [`examples/advanced/moire-mirror-cycle.scene.json`](../examples/advanced/moire-mirror-cycle.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![moire-mirror-cycle terminal](examples/advanced/moire-mirror-cycle-terminal.gif) | ![moire-mirror-cycle ascii](examples/advanced/moire-mirror-cycle-ascii.gif) | ![moire-mirror-cycle webgl](examples/advanced/moire-mirror-cycle-webgl.gif) |

### Neon Layers

Plasma + tunnel (screen) + lasers (additive) → chromatic-aberration → glow → crt.

**Scene:** [`examples/advanced/neon-layers.scene.json`](../examples/advanced/neon-layers.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![neon-layers terminal](examples/advanced/neon-layers-terminal.gif) | ![neon-layers ascii](examples/advanced/neon-layers-ascii.gif) | ![neon-layers webgl](examples/advanced/neon-layers-webgl.gif) |

### Raymarcher Metaballs

Raymarcher (GLSL file) + metaballs → screen-blend → color-grade.

**Scene:** [`examples/advanced/raymarcher-metaballs.scene.json`](../examples/advanced/raymarcher-metaballs.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![raymarcher-metaballs terminal](examples/advanced/raymarcher-metaballs-terminal.gif) | ![raymarcher-metaballs ascii](examples/advanced/raymarcher-metaballs-ascii.gif) | ![raymarcher-metaballs webgl](examples/advanced/raymarcher-metaballs-webgl.gif) |

### Scroller ASCII

Starfield + scroller (`asciiFont`) → alpha-blend → palette-flash (track) → ansi-art.

**Scene:** [`examples/advanced/scroller-ascii.scene.json`](../examples/advanced/scroller-ascii.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![scroller-ascii terminal](examples/advanced/scroller-ascii-terminal.gif) | ![scroller-ascii ascii](examples/advanced/scroller-ascii-ascii.gif) | ![scroller-ascii webgl](examples/advanced/scroller-ascii-webgl.gif) |

### Text Title

Plasma + text → screen-blend → feedback → glow → crt.

**Scene:** [`examples/advanced/text-title.scene.json`](../examples/advanced/text-title.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![text-title terminal](examples/advanced/text-title-terminal.gif) | ![text-title ascii](examples/advanced/text-title-ascii.gif) | ![text-title webgl](examples/advanced/text-title-webgl.gif) |

### Transition Playground

Plasma ↔ lissajous via `transition` (`iris`, Rocket `transition.progress`).

**Scene:** [`examples/advanced/transition-playground.scene.json`](../examples/advanced/transition-playground.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![transition-playground terminal](examples/advanced/transition-playground-terminal.gif) | ![transition-playground ascii](examples/advanced/transition-playground-ascii.gif) | ![transition-playground webgl](examples/advanced/transition-playground-webgl.gif) |

### Tunnel Roto Stack

Tunnel + rotozoom → overlay-blend.

**Scene:** [`examples/advanced/tunnel-roto-stack.scene.json`](../examples/advanced/tunnel-roto-stack.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![tunnel-roto-stack terminal](examples/advanced/tunnel-roto-stack-terminal.gif) | ![tunnel-roto-stack ascii](examples/advanced/tunnel-roto-stack-ascii.gif) | ![tunnel-roto-stack webgl](examples/advanced/tunnel-roto-stack-webgl.gif) |

### Vector Balls Show

Starfield + vector-balls → screen-blend → glow → crt.

**Scene:** [`examples/advanced/vectorballs-show.scene.json`](../examples/advanced/vectorballs-show.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![vectorballs-show terminal](examples/advanced/vectorballs-show-terminal.gif) | ![vectorballs-show ascii](examples/advanced/vectorballs-show-ascii.gif) | ![vectorballs-show webgl](examples/advanced/vectorballs-show-webgl.gif) |

### Voxel Cruise

Starfield + voxel-landscape → additive-blend → feedback → crt.

**Scene:** [`examples/advanced/voxel-cruise.scene.json`](../examples/advanced/voxel-cruise.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![voxel-cruise terminal](examples/advanced/voxel-cruise-terminal.gif) | ![voxel-cruise ascii](examples/advanced/voxel-cruise-ascii.gif) | ![voxel-cruise webgl](examples/advanced/voxel-cruise-webgl.gif) |

### Water Dot

Water ripple + dot-matrix → screen-blend → mirror (quad) → crt.

**Scene:** [`examples/advanced/water-dot.scene.json`](../examples/advanced/water-dot.scene.json)

| ANSI (80×24) | ASCII (160×48 downscaled) | WebGL |
| :---: | :---: | :---: |
| ![water-dot terminal](examples/advanced/water-dot-terminal.gif) | ![water-dot ascii](examples/advanced/water-dot-ascii.gif) | ![water-dot webgl](examples/advanced/water-dot-webgl.gif) |

---

## See also

- [Graph model](graph-model.md)
- [Scene format](scene-format.md)
- [Terminal sink](terminal-sink.md)
- [`overscan-effects-catalogue.md`](../overscan-effects-catalogue.md)

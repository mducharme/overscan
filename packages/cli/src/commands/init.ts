import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const sceneTemplate = (name: string) => JSON.stringify({
  id:         name,
  title:      name,
  duration:   30,
  bpm:        120,
  rowsPerBeat: 8,
  resolution: { width: 640, height: 360 },
  fps:        30,
  tracks:     [],
  graph: {
    nodes: [
      {
        id:     'plasma1',
        type:   'generator',
        impl:   'plasma',
        config: { speed: 1, scale: 1 },
      },
    ],
    edges:   [],
    outputs: { terminal: 'plasma1', browser: 'plasma1', export: 'plasma1' },
  },
}, null, 2)

export async function init(name: string): Promise<void> {
  const dir = name
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'scene.json'), sceneTemplate(name), 'utf8')
  console.log(`✓ created ${dir}/scene.json`)
  console.log(`  overscan run ${dir}/scene.json`)
}

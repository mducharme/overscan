import {
  resolveAnimatableFloat,
  type Generator,
  type NodeContext,
  type FrameBuffer,
  type Signal,
} from '@overscan/types'
import { FireCPU } from './cpu.js'
import type { FireConfig } from './types.js'

export function FireGenerator(config: Partial<FireConfig> = {}): Generator {
  const cfg: FireConfig = {
    cooling: config.cooling ?? 0.5,
    seed:    config.seed    ?? 'random',
    seedIntensity: config.seedIntensity ?? 1,
    seedWidth: config.seedWidth ?? 1,
    spread: config.spread ?? 3,
    wind: config.wind ?? 0,
  }
  if (config.palette !== undefined) cfg.palette = config.palette
  const cpu = new FireCPU()

  return {
    type:       'generator',
    id:         'fire',
    renderers:  ['cpu'],
    config:     cfg as unknown as Generator['config'],
    init(ctx: NodeContext) {
      cpu.init(ctx.width, ctx.height, cfg)
    },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal) {
      const cooling = resolveAnimatableFloat(cfg.cooling ?? 0.5, signal)
      cpu.render(out, signal, cfg, cooling)
    },
    destroy() {},
  }
}

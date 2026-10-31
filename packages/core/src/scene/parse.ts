import { z } from 'zod'
import type { Demo, Scene } from '@overscan/types'

const RocketInterpolationSchema = z.enum([
  'step',
  'linear',
  'smooth',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'elastic',
  'bounce',
  'back',
  'expo-in',
  'expo-out',
])

const RocketKeySchema = z.object({
  row:           z.number(),
  value:         z.number(),
  interpolation: RocketInterpolationSchema,
})

const RocketTrackSchema = z.object({
  name: z.string(),
  keys: z.array(RocketKeySchema),
})

const AudioClipSchema = z.object({
  src: z.string(),
  volume: z.number().nonnegative().optional(),
  pitch: z.number().positive().optional(),
})

const AudioClipOrStringSchema = z.union([z.string(), AudioClipSchema])

const SceneNodeSchema = z.object({
  id:         z.string(),
  type:       z.enum(['generator', 'modifier', 'compositor', 'signal']),
  impl:       z.string(),
  config:     z.record(z.unknown()),
  resolution: z.object({ width: z.number(), height: z.number() }).optional(),
  startTime:  z.number().min(0).optional(),
  endTime:    z.number().min(0).optional(),
})

const CompositorEdgeTransformSchema = z.object({
  position: z.tuple([z.number(), z.number()]),
  scale:    z.tuple([z.number(), z.number()]),
  rotation: z.number().optional(),
})

const SceneEdgeSchema = z.object({
  from:      z.object({ node: z.string(), output: z.string() }),
  to:        z.object({ node: z.string(), input: z.string() }),
  z:         z.number().optional(),
  transform: CompositorEdgeTransformSchema.optional(),
})

const SceneGraphSchema = z.object({
  nodes:   z.array(SceneNodeSchema),
  edges:   z.array(SceneEdgeSchema),
  outputs: z.record(z.string()),
})

export const SceneSchema = z.object({
  id:          z.string(),
  title:       z.string(),
  duration:    z.number().positive(),
  bpm:         z.number().positive(),
  rowsPerBeat: z.number().int().positive().default(8),
  audio:       AudioClipOrStringSchema.optional(),
  resolution:  z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  fps:         z.number().positive().default(60),
  tracks:      z.array(RocketTrackSchema).default([]),
  graph:       SceneGraphSchema,
})

const DemoTransitionSchema = z.object({
  type:     z.enum(['cut', 'dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'zoom-out', 'flash', 'iris', 'blinds', 'checker', 'push', 'melt']),
  duration: z.number().positive().optional(),
  easing:   RocketInterpolationSchema.optional(),
  flashColor: z.string().optional(),
})

const DemoSectionSchema = z.object({
  id:         z.string(),
  scene:      z.string(),
  duration:   z.number().positive().optional(),
  transition: DemoTransitionSchema.optional(),
})

const DemoModifierSchema = z.object({
  id: z.string(),
  impl: z.string(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).default({}),
})

export const DemoSchema = z.object({
  id:        z.string(),
  title:     z.string(),
  audio:     AudioClipOrStringSchema.optional(),
  loop:      z.boolean().optional(),
  modifiers: z.array(DemoModifierSchema).default([]),
  sections:  z.array(DemoSectionSchema).min(1),
})

function formatParseIssues(prefix: string, issues: z.ZodIssue[]): never {
  const text = issues
    .map(i => `  ${i.path.join('.')} — ${i.message}`)
    .join('\n')
  throw new Error(`${prefix}:\n${text}`)
}

export function parseSceneJson(json: string): Scene {
  const parsed = JSON.parse(json) as unknown
  const result = SceneSchema.safeParse(parsed)
  if (!result.success) formatParseIssues('Invalid scene file', result.error.issues)
  return result.data as Scene
}

export function parseDemoJson(json: string): Demo {
  const parsed = JSON.parse(json) as unknown
  const result = DemoSchema.safeParse(parsed)
  if (!result.success) formatParseIssues('Invalid demo file', result.error.issues)
  return result.data as Demo
}

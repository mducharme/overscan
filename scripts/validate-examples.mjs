#!/usr/bin/env node
/**
 * Run `overscan validate` on every *.scene.json and *.demo.json under examples/.
 * Skips node_modules and dist. Requires a prior `pnpm build` (CLI dist).
 */
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const EXAMPLES = join(ROOT, 'examples')
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'cli.js')

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

async function* walkFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield* walkFiles(full)
    } else {
      yield full
    }
  }
}

async function collectTargets() {
  const paths = []
  for await (const abs of walkFiles(EXAMPLES)) {
    const name = basename(abs)
    if (name.endsWith('.scene.json') || name.endsWith('.demo.json')) paths.push(abs)
  }
  paths.sort((a, b) => a.localeCompare(b, 'en'))
  return paths
}

const targets = await collectTargets()
if (targets.length === 0) {
  console.error('validate-examples: no *.scene.json or *.demo.json under examples/')
  process.exit(1)
}

console.log(`validate-examples: ${targets.length} file(s)\n`)

let failed = 0
for (const abs of targets) {
  const label = relative(ROOT, abs).replaceAll('\\', '/')
  console.log(`— ${label}`)
  const r = spawnSync(process.execPath, [CLI, 'validate', abs], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    failed += 1
    console.error(`\nvalidate-examples: FAILED — ${label}\n`)
  }
}

if (failed > 0) {
  console.error(`validate-examples: ${failed}/${targets.length} failed`)
  process.exit(1)
}
console.log(`\nvalidate-examples: all ${targets.length} OK`)

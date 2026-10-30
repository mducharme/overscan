import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectMode } from './detect.js'

describe('detectMode', () => {
  const snapshot: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ['WEZTERM_EXECUTABLE', 'DEMO_SIXEL', 'TERM_PROGRAM', 'TERM', 'COLORTERM']) {
      snapshot[k] = process.env[k]
    }
    delete process.env['WEZTERM_EXECUTABLE']
    delete process.env['DEMO_SIXEL']
    process.env['TERM'] = 'dumb'
    delete process.env['TERM_PROGRAM']
    delete process.env['COLORTERM']
  })

  afterEach(() => {
    for (const k of Object.keys(snapshot)) {
      const v = snapshot[k]
      if (v === undefined) Reflect.deleteProperty(process.env, k)
      else process.env[k] = v
    }
  })

  it('WezTerm defaults to ansi', () => {
    process.env['WEZTERM_EXECUTABLE'] = '/usr/bin/wezterm'
    expect(detectMode()).toBe('ansi')
  })

  it('WezTerm uses sixel when DEMO_SIXEL=1', () => {
    process.env['WEZTERM_EXECUTABLE'] = '/usr/bin/wezterm'
    process.env['DEMO_SIXEL'] = '1'
    expect(detectMode()).toBe('sixel')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { terminalResolution, terminalResolutionFromGrid } from './resolution.js'

// mock stdout dimensions
vi.stubGlobal('process', {
  ...process,
  stdout: { ...process.stdout, columns: 80, rows: 24 },
})

describe('terminalResolution', () => {
  it('sixel: doubles columns and rows', () => {
    const r = terminalResolution('sixel')
    expect(r.width).toBe(160)
    expect(r.height).toBe(48)
  })

  it('ansi: columns wide, rows*2 tall', () => {
    const r = terminalResolution('ansi')
    expect(r.width).toBe(80)
    expect(r.height).toBe(48)
  })

  it('ascii: full character grid cols × rows', () => {
    const r = terminalResolution('ascii')
    expect(r.width).toBe(80)
    expect(r.height).toBe(24)
  })
})

describe('terminalResolutionFromGrid', () => {
  it('ansi: cols × (rows*2) pixel buffer', () => {
    expect(terminalResolutionFromGrid('ansi', 80, 24)).toEqual({ width: 80, height: 48 })
  })

  it('ascii: cols × rows', () => {
    expect(terminalResolutionFromGrid('ascii', 80, 24)).toEqual({ width: 80, height: 24 })
  })

  it('sixel: (cols*2) × (rows*2)', () => {
    expect(terminalResolutionFromGrid('sixel', 80, 24)).toEqual({ width: 160, height: 48 })
  })
})

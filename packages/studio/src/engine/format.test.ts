import { describe, expect, it } from 'vitest'
import { formatTime } from './format'

describe('formatTime', () => {
  it('formats minutes, seconds and tenths', () => {
    expect(formatTime(0)).toBe('0:00.0')
    expect(formatTime(9.96)).toBe('0:09.9')
    expect(formatTime(83.42)).toBe('1:23.4')
    expect(formatTime(-2)).toBe('0:00.0')
    expect(formatTime(Number.NaN)).toBe('0:00.0')
  })
})

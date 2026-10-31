import { describe, expect, it } from 'vitest'
import { makeSocketPath } from './terminal-audio.js'

describe('mpv IPC socket path', () => {
  it('stays within the Unix socket path limit even under a long temp folder', () => {
    const longDir = '/var/folders/y7/95nlyqzj7qs8l9q2mccxnk100000gn/T/overscan-mpv-12345-1254ca11-5113-4173-8982-a5bcee6c758c'
    if (process.platform === 'win32') return
    expect(Buffer.byteLength(makeSocketPath(longDir, 'demo:showcase'))).toBeLessThanOrEqual(100)
    expect(makeSocketPath('/tmp/x', 'scene')).toBe('/tmp/x/scene.sock')
  })
})

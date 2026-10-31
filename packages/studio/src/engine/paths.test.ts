import { describe, expect, it } from 'vitest'
import { baseName, relativePath, resolvePath } from './paths'

describe('resolvePath', () => {
  it('resolves relative paths against a POSIX file, keeping forward slashes', () => {
    expect(resolvePath('/home/me/examples/showcase.demo.json', './showcase/01-intro.scene.json'))
      .toBe('/home/me/examples/showcase/01-intro.scene.json')
    expect(resolvePath('/home/me/examples/generators/raymarcher.scene.json', '../shaders/monument.glsl'))
      .toBe('/home/me/examples/shaders/monument.glsl')
  })

  it('keeps Windows separators for Windows bases', () => {
    expect(resolvePath('C:\\work\\examples\\showcase.demo.json', './showcase/01-intro.scene.json'))
      .toBe('C:\\work\\examples\\showcase\\01-intro.scene.json')
  })

  it('leaves absolute paths and URLs alone', () => {
    expect(resolvePath('/a/b.json', '/etc/x.png')).toBe('/etc/x.png')
    expect(resolvePath('/a/b.json', 'https://example.com/x.png')).toBe('https://example.com/x.png')
    expect(resolvePath('/a/b.json', 'overscan://fonts/Tiny5x7')).toBe('overscan://fonts/Tiny5x7')
  })

  it('gives the file name', () => {
    expect(baseName('/a/b/plasma.scene.json')).toBe('plasma.scene.json')
    expect(baseName('C:\\a\\demo.json')).toBe('demo.json')
  })
})

describe('relativePath', () => {
  it('walks down and up from the base file directory', () => {
    expect(relativePath('/p/examples/show.demo.json', '/p/examples/showcase/a.scene.json')).toBe('./showcase/a.scene.json')
    expect(relativePath('/p/examples/sub/x.demo.json', '/p/examples/a.scene.json')).toBe('../a.scene.json')
    expect(relativePath('/p/a/b/x.demo.json', '/p/c/d.scene.json')).toBe('../../c/d.scene.json')
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, Notice, Panel, ToggleGroup } from './kit'

describe('ui kit', () => {
  it('renders native, labelled controls', () => {
    const toggle = renderToStaticMarkup(createElement(ToggleGroup<'a' | 'b'>, {
      label: 'Renderer', value: 'b', onChange: () => {}, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    }))
    expect(toggle).toContain('role="group" aria-label="Renderer"')
    expect(toggle).toContain('aria-pressed="true">B')
    expect(renderToStaticMarkup(createElement(Button, { variant: 'primary' }, 'Play'))).toBe('<button type="button" class="ui-button ui-button--primary">Play</button>')
    expect(renderToStaticMarkup(createElement(Notice, { kind: 'error', children: 'Boom' }))).toContain('role="alert"')
    expect(renderToStaticMarkup(createElement(Panel, { title: 'Preview', children: 'x' }))).toContain('<h2 class="ui-panel__title">Preview</h2>')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { isTextEntryTarget } from '@/lib/domFocus'

afterEach(() => { document.body.innerHTML = '' })

function mount<T extends HTMLElement>(html: string): T {
  document.body.innerHTML = html
  return document.body.firstElementChild as T
}

describe('isTextEntryTarget', () => {
  it('accepts an explicit target', () => {
    expect(isTextEntryTarget(mount('<input />'))).toBe(true)
    expect(isTextEntryTarget(mount('<textarea></textarea>'))).toBe(true)
    expect(isTextEntryTarget(mount('<select></select>'))).toBe(true)
  })

  it('rejects non-text elements', () => {
    expect(isTextEntryTarget(mount('<button>Go</button>'))).toBe(false)
    expect(isTextEntryTarget(mount('<div>text</div>'))).toBe(false)
    expect(isTextEntryTarget(mount('<canvas></canvas>'))).toBe(false)
  })

  it('accepts contenteditable hosts', () => {
    const el = mount<HTMLDivElement>('<div contenteditable="true">x</div>')
    expect(isTextEntryTarget(el)).toBe(true)
  })

  it('handles null and non-element targets', () => {
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget({} as EventTarget)).toBe(false)
  })

  // Regression guard: EditorLayer's Q/W/E/R shortcuts call this with no
  // argument, so typing "w" in a rename field must not switch the gizmo tool.
  it('falls back to the focused element when no target is given', () => {
    const input = mount<HTMLInputElement>('<input />')
    input.focus()
    expect(isTextEntryTarget()).toBe(true)

    input.blur()
    expect(isTextEntryTarget()).toBe(false)
  })
})

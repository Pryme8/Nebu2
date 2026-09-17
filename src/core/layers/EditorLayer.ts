import { ILayer } from './ILayer'
import type { IEvent } from './IEvent'
import type { ILayerContext } from './LayerStack'
import {
  KeyDownEvent,
  KeyUpEvent,
  MouseMoveEvent,
  MouseDownEvent,
  MouseUpEvent,
  MouseWheelEvent,
  WindowResizeEvent,
} from './events'
import { EventType, type ModifierKeys } from '@/types/layer'
import { useEditorStore } from '@/stores/editorStore'
import { isTextEntryTarget } from '@/lib/domFocus'

/**
 * EditorLayer — the primary layer of the Nebu2 editor.
 *
 * Responsibilities:
 *  - Bridges native DOM events (keyboard, mouse, window resize) into the
 *    LayerStack's typed event system.
 *  - Handles editor-specific shortcuts (tool selection, etc.) in onEvent.
 *  - Does NOT drive rendering — that is delegated to RenderLayer.
 *
 * This is the largest layer and always sits at the top of the stack so it
 * gets first-priority event handling. Unhandled events propagate downward.
 */
export class EditorLayer extends ILayer {
  readonly name = 'EditorLayer'

  private readonly _stack: ILayerContext

  constructor(stack: ILayerContext) {
    super()
    this._stack = stack
  }

  override onAttach(): void {
    window.addEventListener('keydown',   this._handleKeyDown)
    window.addEventListener('keyup',     this._handleKeyUp)
    window.addEventListener('mousemove', this._handleMouseMove)
    window.addEventListener('mousedown', this._handleMouseDown)
    window.addEventListener('mouseup',   this._handleMouseUp)
    window.addEventListener('wheel',     this._handleWheel, { passive: true })
    window.addEventListener('resize',    this._handleResize)
  }

  override onDetach(): void {
    window.removeEventListener('keydown',   this._handleKeyDown)
    window.removeEventListener('keyup',     this._handleKeyUp)
    window.removeEventListener('mousemove', this._handleMouseMove)
    window.removeEventListener('mousedown', this._handleMouseDown)
    window.removeEventListener('mouseup',   this._handleMouseUp)
    window.removeEventListener('wheel',     this._handleWheel)
    window.removeEventListener('resize',    this._handleResize)
  }

  /** Vue reactivity drives the UI — nothing extra needed here per frame. */
  override onUpdate(_dt: number): void {}

  override onEvent(event: IEvent): void {
    // EditorLayer handles tool shortcuts and other editor-wide key bindings.
    if (event.type === EventType.KeyDown) {
      const { key, modifiers } = event as KeyDownEvent
      // Only act when no modifier keys are held (prevents browser-shortcut conflicts)
      // and the user isn't typing — these are bare single-letter shortcuts, so
      // without the focus check "w" in a rename field would switch tools.
      if (!modifiers.ctrl && !modifiers.alt && !isTextEntryTarget()) {
        this._handleToolShortcut(key)
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _handleToolShortcut(key: string): void {
    const store = useEditorStore()
    switch (key.toLowerCase()) {
      case 'q': store.activeTool = 'select';    break
      case 'w': store.activeTool = 'translate'; break
      case 'e': store.activeTool = 'rotate';    break
      case 'r': store.activeTool = 'scale';     break
    }
  }

  private _modifiers(e: MouseEvent | KeyboardEvent | WheelEvent): ModifierKeys {
    return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey }
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    const ev = new KeyDownEvent(e.key, e.code, this._modifiers(e), e.repeat)
    this._stack.dispatchEvent(ev)
  }

  private _handleKeyUp = (e: KeyboardEvent): void => {
    const ev = new KeyUpEvent(e.key, e.code, this._modifiers(e))
    this._stack.dispatchEvent(ev)
  }

  private _prevX = 0
  private _prevY = 0

  private _handleMouseMove = (e: MouseEvent): void => {
    const ev = new MouseMoveEvent(e.clientX, e.clientY, e.clientX - this._prevX, e.clientY - this._prevY)
    this._prevX = e.clientX
    this._prevY = e.clientY
    this._stack.dispatchEvent(ev)
  }

  private _handleMouseDown = (e: MouseEvent): void => {
    const ev = new MouseDownEvent(e.clientX, e.clientY, e.button, this._modifiers(e))
    this._stack.dispatchEvent(ev)
  }

  private _handleMouseUp = (e: MouseEvent): void => {
    const ev = new MouseUpEvent(e.clientX, e.clientY, e.button, this._modifiers(e))
    this._stack.dispatchEvent(ev)
  }

  private _handleWheel = (e: WheelEvent): void => {
    const ev = new MouseWheelEvent(e.clientX, e.clientY, e.deltaY, this._modifiers(e))
    this._stack.dispatchEvent(ev)
  }

  private _handleResize = (): void => {
    const ev = new WindowResizeEvent(window.innerWidth, window.innerHeight)
    this._stack.dispatchEvent(ev)
  }
}

// ─────────────────────────────────────────────
// Command — undo/redo interface
// ─────────────────────────────────────────────

/**
 * ICommand — base interface for all undoable editor operations.
 *
 * Every mutation that should participate in the undo/redo chain must be
 * wrapped in an ICommand.  The commandStore manages the stacks and executes
 * forward/backward on request.
 *
 * Workflow:
 *   commandStore.execute(new SomeCommand(...))   // runs + pushes to undo stack
 *   commandStore.undo()                          // reverses last command
 *   commandStore.redo()                          // re-applies last undone command
 */
export interface ICommand {
  /** Human-readable label shown in Undo/Redo menu items. */
  readonly description: string

  /** Run (or re-run) the action. Called by execute() and redo(). */
  execute(): void

  /** Reverse the action. Called by undo(). */
  undo(): void

  /**
   * When true, commandStore will not push an automatic notification toast on
   * execute().  Undo/redo always produce a toast regardless of this flag.
   * Useful for high-frequency commands such as numeric scrubbing.
   */
  readonly silent?: boolean

  /**
   * Optional merge key.  When two consecutive commands share the same key
   * (e.g. dragging a numeric scrubber), the newer command is coalesced into
   * the previous step via tryMerge() instead of creating a separate undo entry.
   */
  readonly mergeKey?: string

  /**
   * Attempt to absorb `newer` (which has the same mergeKey).
   * Mutate this command in-place to adopt the newer end-state and return
   * `this`, or return null to reject the merge (both commands are kept).
   */
  tryMerge?(newer: ICommand): ICommand | null
}

/**
 * Implemented by any class whose state can be serialized to/from a
 * plain JSON-compatible record (safe to save to localStorage, a file, etc.).
 *
 * T is the exact shape of the serialized data.  Defaults to a loose record so
 * callers that don't need the precise type can omit the type parameter.
 */
export interface ISerializable<T extends Record<string, unknown> = Record<string, unknown>> {
  serialize(): T
}

/**
 * A round-trip serializable object that can also restore itself from data.
 * Extend this when the same class instance is reused across sessions
 * (e.g. stores, layers, services).
 */
export interface IStatefulSerializable<T extends Record<string, unknown> = Record<string, unknown>>
  extends ISerializable<T> {
  deserializeState(data: T): void
}

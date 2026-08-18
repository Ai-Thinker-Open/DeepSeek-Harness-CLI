/**
 * Minimal structural surface of the Cordis host context the dsh bundle
 * plugins depend on. Kept local so the bundle runs inside the official dsh
 * process without importing any `@deepseek-ai/*` package at runtime or
 * compile time (the loader passes its own Context instance to `apply`).
 */

export interface DshContext {
  get<T = unknown>(key: string): T | undefined
  provide(key: string, value: unknown): void
}

/** The launcher-provided inner argument snapshot (`dsh-cmdline`). */
export interface CmdlineArgsLike {
  get(): readonly string[]
}

/** The launcher-provided bounded process-exit request (`dsh-cmdline`). */
export interface AppExitLike {
  (code: number): void
}

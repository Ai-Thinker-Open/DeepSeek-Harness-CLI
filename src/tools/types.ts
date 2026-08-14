import type { ToolContext } from '../types.ts'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** 'ask' tools need user confirmation in interactive mode unless auto-approved. */
  permission: 'auto' | 'ask'
  /** Allowed while plan mode is active (read-only / planning-only tools). */
  planSafe: boolean
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string> | string
  /** One-liner shown on the tool card. */
  summary?: (args: Record<string, unknown>) => string
}

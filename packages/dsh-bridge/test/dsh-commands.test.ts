import { describe, expect, it } from 'bun:test'
import {
  compactCommand,
  goalCommand,
  parseDshCommand,
  permissionCommand,
  planCommand,
} from '../../../src/opencode-bridge/dsh-commands.ts'

describe('DSH command grammar', () => {
  it('parses known slash commands and preserves raw input', () => {
    expect(parseDshCommand('/plan')).toEqual({ name: 'plan', rawInput: '' })
    expect(parseDshCommand('/goal edit ship')).toEqual({ name: 'goal', rawInput: ' edit ship' })
    expect(parseDshCommand('/compact')).toEqual({ name: 'compact', rawInput: '' })
    expect(parseDshCommand('/permission workspace-write')).toEqual({ name: 'permission', rawInput: ' workspace-write' })
    expect(parseDshCommand('plan')).toBeUndefined()
    expect(parseDshCommand('/unknown')).toBeUndefined()
  })

  it('matches DSH plan-mode semantics', () => {
    expect(planCommand('')).toEqual({ kind: 'on' })
    expect(planCommand('off')).toEqual({ kind: 'off' })
    expect(planCommand('draft migration')).toEqual({ kind: 'on', message: 'draft migration' })
  })

  it('matches DSH goal grammar', () => {
    expect(goalCommand('')).toEqual({ kind: 'view' })
    expect(goalCommand('clear')).toEqual({ kind: 'clear' })
    expect(goalCommand('pause')).toEqual({ kind: 'pause' })
    expect(goalCommand('resume')).toEqual({ kind: 'resume' })
    expect(goalCommand('edit ship it')).toEqual({ kind: 'edit', objective: 'ship it' })
    expect(goalCommand('ship it')).toEqual({ kind: 'create', objective: 'ship it' })
  })

  it('matches DSH permission and compact behavior', () => {
    expect(permissionCommand('')).toEqual({ kind: 'view' })
    expect(permissionCommand('workspace-write')).toEqual({ kind: 'set', preset: 'workspace-write' })
    expect(permissionCommand('danger-full-access')).toEqual({ kind: 'set', preset: 'danger-full-access' })
    expect(permissionCommand('nope')).toEqual({ kind: 'unknown', preset: 'nope' })
    expect(compactCommand('')).toEqual({ ok: true })
    expect(compactCommand('extra')).toEqual({ ok: false, error: 'Usage: /compact (no arguments)' })
  })
})

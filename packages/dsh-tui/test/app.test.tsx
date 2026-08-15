/** @jsxImportSource @opentui/solid */
import { expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import { BridgeStore } from '@dsh/core'
import { App } from '../src/App.tsx'
import type { DshRuntime } from '../src/dsh.ts'

test('home shell renders DeepSeek Harness CLI and session list', async () => {
  const store = new BridgeStore('/tmp/project')
  store.upsertSession({
    sessionId: 'ses-1',
    updatedAt: Date.now(),
    running: false,
    blank: false,
    cwd: '/tmp/project',
  })

  const runtime: DshRuntime = {
    store,
    async start() {},
    async refreshSessions() {},
    async createSession() {
      return store.getSession('ses-1')!
    },
    async loadHistory() {},
    async prompt() {},
    async abort() {},
    async listCommands() {
      return [{ name: 'plan', description: 'Enter or leave plan mode' }]
    },
    async executeCommand() {},
    async answerQuestion() {},
    subscribe(listener) {
      return store.subscribe(listener)
    },
    stop() {},
  }

  const app = await testRender(() => <App dsh={runtime} />)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain('DeepSeek Harness CLI')
  expect(frame).toContain('sessions')
  expect(frame).toContain('ses-1')
})

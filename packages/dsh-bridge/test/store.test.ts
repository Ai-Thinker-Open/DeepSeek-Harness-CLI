import { describe, expect, it } from 'bun:test'
import { BridgeStore } from '../src/store.ts'
import type { SessionEvent } from '../src/harness.ts'

function event(type: string, data: Record<string, unknown>, seq = 1): SessionEvent {
  return { type, seq, time: 1700000000000 + seq, data }
}

describe('BridgeStore event projection', () => {
  it('projects user and assistant messages into OpenCode message/part shapes', () => {
    const store = new BridgeStore('/tmp/project')
    store.applyEvent('s1', event('user/message', { content: [{ type: 'text', text: 'hello' }] }))
    store.applyEvent('s1', event('assistant/message', {
      message: {
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'world' },
        ],
      },
    }))

    const messages = store.getMessages('s1')
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(store.getParts('s1', messages[0]!.id).some((part) => part.type === 'text')).toBe(true)
    expect(store.getParts('s1', messages[1]!.id).some((part) => part.type === 'reasoning')).toBe(true)
  })

  it('applies todos projection and status updates', () => {
    const store = new BridgeStore('/tmp/project')
    store.applyProjection('s1', 'todos', [
      { id: '1', content: 'do a', status: 'pending' },
      { id: '2', content: 'do b', status: 'completed' },
    ])
    store.setStatus('s1', { type: 'busy', message: 'working' })

    expect(store.getTodos('s1')).toEqual([
      { id: '1', content: 'do a', status: 'pending' },
      { id: '2', content: 'do b', status: 'completed' },
    ])
    expect(store.getStatus('s1')).toEqual({ type: 'busy', message: 'working' })
  })
})

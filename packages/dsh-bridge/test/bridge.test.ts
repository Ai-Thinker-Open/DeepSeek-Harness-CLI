import { describe, expect, it } from 'bun:test'
import { DshOpenCodeBridge } from '../src/bridge.ts'
import type { OpenCodeGlobalEvent } from '../src/types.ts'

function frame(method: string, payload: unknown, rpcId = 'rpc-1') {
  return { type: 'server-request', rpcId, method, payload }
}

describe('DshOpenCodeBridge question projection', () => {
  it('projects DSH permission and question requests into OpenCode events and replies through the DSH RPC', async () => {
    const bridge = new DshOpenCodeBridge({ harnessUrl: 'http://127.0.0.1:3999', directory: '/tmp' })
    const events: OpenCodeGlobalEvent[] = []
    bridge.subscribe((event) => events.push(event))

    const responses: Array<{ rpcId: string; sessionId: string; answers: Array<{ id: string; selected: string[] }> }> = []
    ;(bridge.client as any).respond = async (rpcId: string, sessionId: string, answers: Array<{ id: string; selected: string[] }>) => {
      responses.push({ rpcId, sessionId, answers })
    }

    ;(bridge as any).handleFrame(frame('question/requested', {
      sessionId: 's1',
      questions: [
        {
          id: 'q1',
          question: 'Allow this command?',
          header: 'Permission required',
          options: [{ label: 'Allow' }, { label: 'Deny' }],
        },
      ],
    }))

    const asked = events.find((event) => event.payload.type === 'permission.asked')
    expect(asked?.payload.type).toBe('permission.asked')
    if (asked?.payload.type === 'permission.asked') {
      expect(asked.payload.properties.id).toBe('q1')
      expect(asked.payload.properties.sessionID).toBe('s1')
    }

    await bridge.replyPermission('q1', 'reject')
    expect(responses[0]?.answers[0]).toEqual({ id: 'q1', selected: ['Deny'] })
    expect(events.some((event) => event.payload.type === 'permission.replied')).toBe(true)

    ;(bridge as any).handleFrame(frame('question/requested', {
      sessionId: 's2',
      questions: [
        {
          id: 'q2',
          question: 'Choose a name',
          options: [{ label: 'Ada' }, { label: 'Linus' }],
        },
      ],
    }))

    const askedQuestion = events.find((event) => event.payload.type === 'question.asked')
    expect(askedQuestion?.payload.type).toBe('question.asked')
    await bridge.replyQuestion('q2', [['Ada']])
    expect(responses[1]?.answers[0]).toEqual({ id: 'q2', selected: ['Ada'] })
    expect(events.some((event) => event.payload.type === 'question.replied')).toBe(true)
  })
})

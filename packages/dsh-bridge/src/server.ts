import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { DshOpenCodeBridge } from './bridge.ts'
import type { OpenCodeGlobalEvent } from './types.ts'

const VERSION = 'dsh-opencode-bridge/0.1.0'

type SseSink = (data: string) => void | Promise<void>

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function createBridgeServer(bridge: DshOpenCodeBridge) {
  const app = new Hono()
  const sinks = new Set<SseSink>()

  const broadcast = (event: OpenCodeGlobalEvent): void => {
    const data = JSON.stringify(event)
    for (const sink of sinks) void sink(data)
  }

  const unsub = bridge.subscribe(broadcast)

  app.get('/global/health', (c) => c.json({ healthy: true, version: VERSION }))

  app.get('/global/event', (c) => {
    return streamSSE(c, async (stream) => {
      const sink: SseSink = (data) => stream.writeSSE({ data })
      sinks.add(sink)
      await sink(JSON.stringify({
        directory: bridge.store.directory,
        payload: { type: 'server.connected', properties: {} },
      } satisfies OpenCodeGlobalEvent))
      const heartbeat = setInterval(() => {
        void sink(JSON.stringify({
          directory: bridge.store.directory,
          payload: { type: 'server.connected', properties: {} },
        } satisfies OpenCodeGlobalEvent))
      }, 10_000)
      stream.onAbort(() => {
        clearInterval(heartbeat)
        sinks.delete(sink)
      })
      while (true) {
        await stream.sleep(60_000)
      }
    })
  })

  app.get('/global/config', (c) => c.json({}))
  app.get('/config', (c) => c.json({}))
  app.get('/provider', (c) => c.json([]))
  app.get('/provider/auth', (c) => c.json([]))
  app.get('/agent', (c) =>
    c.json([
      {
        name: 'build',
        description: 'DSH build agent',
        mode: 'primary',
        tools: [],
        permission: [],
      },
    ]),
  )

  app.get('/command', async (c) => {
    return c.json(await bridge.listCommands(''))
  })

  app.get('/session/status', (c) => c.json({}))

  app.get('/session', async (c) => {
    await bridge.refreshSessions()
    return c.json(bridge.store.listSessions())
  })

  app.post('/session', async (c) => {
    let body: { directory?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      // empty body is valid
    }
    const session = await bridge.createSession(body.directory ?? bridge.store.directory)
    return c.json(session)
  })

  app.get('/session/:sessionID', async (c) => {
    const sessionID = c.req.param('sessionID')
    const session = bridge.store.getSession(sessionID)
    if (!session) return jsonError(404, 'session not found')
    return c.json(session)
  })

  app.get('/session/:sessionID/message', async (c) => {
    const sessionID = c.req.param('sessionID')
    await bridge.loadHistory(sessionID)
    const messages = bridge.store.getMessages(sessionID)
    return c.json(
      messages.map((info) => ({
        info,
        parts: bridge.store.getParts(sessionID, info.id),
      })),
    )
  })

  app.post('/session/:sessionID/message', async (c) => {
    const sessionID = c.req.param('sessionID')
    const body = await c.req.json<{ parts?: Array<{ type?: string; text?: string }> }>()
    const text = (body.parts ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('')
    if (!text.trim()) return jsonError(400, 'message text is required')
    await bridge.prompt(sessionID, text)
    return c.json({ accepted: true })
  })

  app.post('/session/:sessionID/prompt_async', async (c) => {
    const sessionID = c.req.param('sessionID')
    const body = await c.req.json<{ parts?: Array<{ type?: string; text?: string }> }>()
    const text = (body.parts ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('')
    if (!text.trim()) return jsonError(400, 'message text is required')
    void bridge.prompt(sessionID, text)
    return c.body(null, 204)
  })

  app.post('/session/:sessionID/abort', async (c) => {
    const sessionID = c.req.param('sessionID')
    await bridge.abort(sessionID)
    return c.json(true)
  })

  app.get('/session/:sessionID/todo', async (c) => {
    const sessionID = c.req.param('sessionID')
    await bridge.loadHistory(sessionID)
    return c.json(bridge.store.getTodos(sessionID))
  })

  app.get('/session/:sessionID/diff', (c) => c.json([]))
  app.get('/session/:sessionID/actors', (c) => c.json([]))
  app.get('/session/:sessionID/task', (c) => c.json([]))
  app.get('/session/:sessionID/children', (c) => c.json([]))

  app.post('/session/:sessionID/command', async (c) => {
    const sessionID = c.req.param('sessionID')
    const body = await c.req.json<{ command?: string; arguments?: string }>()
    const command = body.command
    const line = command ? `/${command}${body.arguments ?? ''}` : ''
    if (!line.trim()) return jsonError(400, 'command is required')
    const result = await bridge.executeCommand(sessionID, line)
    return c.json(result ?? { ok: true })
  })

  app.get('/app/command', async (c) => {
    const sessionID = c.req.query('sessionID')
    if (!sessionID) return c.json([])
    return c.json(await bridge.listCommands(sessionID))
  })

  app.get('/session/:sessionID/command', async (c) => {
    const sessionID = c.req.param('sessionID')
    return c.json(await bridge.listCommands(sessionID))
  })

  app.onError((error, c) => {
    return jsonError(500, error instanceof Error ? error.message : 'bridge internal error')
  })

  return {
    app,
    close() {
      unsub()
      sinks.clear()
      bridge.stop()
    },
  }
}

export function startBridgeServer(bridge: DshOpenCodeBridge, port: number, hostname = '127.0.0.1') {
  const { app, close } = createBridgeServer(bridge)
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    console.log(`dsh-opencode-bridge listening on http://${hostname}:${port}`)
  })
  return {
    close() {
      close()
      server.close()
    },
  }
}

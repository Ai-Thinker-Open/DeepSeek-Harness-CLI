import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { DshOpenCodeBridge } from './bridge.ts'
import type { OpenCodeGlobalEvent } from './types.ts'

const VERSION = 'dsh-opencode-bridge/0.1.0'

const DEEPSEEK_PROVIDER = {
  id: 'deepseek',
  name: 'DeepSeek',
  source: 'config',
  env: [],
  options: {},
  models: {
    'deepseek-chat': {
      id: 'deepseek-chat',
      providerID: 'deepseek',
      api: { id: 'deepseek-chat', url: '', npm: '' },
      name: 'DeepSeek Chat',
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128000, output: 8192 },
      status: 'active',
      options: {},
      headers: {},
      release_date: '2024-01-01',
    },
  },
}

const DEEPSEEK_MODEL = { providerID: 'deepseek', modelID: 'deepseek-chat' }
const CONSOLE_STATE = {
  consoleManagedProviders: [],
  activeOrgName: undefined,
  switchableOrgCount: 0,
}

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

  app.use('*', async (c, next) => {
    const start = Date.now()
    await next()
    console.error(`[bridge] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - start}ms)`)
  })

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
          payload: { type: 'server.heartbeat', properties: {} },
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

  app.get('/global/config', (c) => c.json({ model: 'deepseek/deepseek-chat' }))
  app.get('/config', (c) => c.json({ model: 'deepseek/deepseek-chat' }))
  app.get('/config/providers', (c) =>
    c.json({ providers: [DEEPSEEK_PROVIDER], default: { deepseek: 'deepseek-chat' } }),
  )
  app.get('/provider', (c) =>
    c.json({
      all: [DEEPSEEK_PROVIDER],
      default: { deepseek: 'deepseek-chat' },
      connected: ['deepseek'],
      authenticated: ['deepseek'],
    }),
  )
  app.get('/provider/auth', (c) => c.json({}))
  app.get('/agent', (c) =>
    c.json([
      {
        name: 'build',
        description: 'DSH build agent',
        mode: 'primary',
        native: true,
        hidden: false,
        color: '#FF7A1A',
        permission: [],
        hardPermission: [],
        model: DEEPSEEK_MODEL,
        options: {},
      },
    ]),
  )
  app.get('/path', (c) =>
    c.json({
      home: '',
      state: '',
      config: '',
      worktree: '',
      directory: bridge.store.directory,
    }),
  )
  app.get('/project/current', (c) => c.json({ id: '', worktree: bridge.store.directory }))
  app.get('/experimental/console', (c) => c.json(CONSOLE_STATE))
  app.get('/experimental/console/orgs', (c) => c.json([]))
  app.get('/experimental/workspace', (c) => c.json([]))
  app.get('/experimental/workspace/adaptor', (c) => c.json([]))
  app.get('/experimental/workspace/status', (c) => c.json([]))
  app.get('/experimental/resource', (c) => c.json({}))
  app.get('/lsp/status', (c) => c.json([]))
  app.get('/mcp/status', (c) => c.json({}))
  app.get('/formatter/status', (c) => c.json([]))
  app.get('/vcs', (c) => c.json({ branch: undefined, default_branch: undefined }))
  app.get('/skill', (c) => c.json([]))

  app.get('/command', async (c) => {
    return c.json(await bridge.listCommands(''))
  })

  app.get('/session/status', (c) =>
    c.json(Object.fromEntries(bridge.store.listSessions().map((session) => [session.id, bridge.store.getStatus(session.id)]))),
  )

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
    let session = bridge.store.getSession(sessionID)
    if (!session) {
      await bridge.refreshSessions().catch(() => {})
      session = bridge.store.getSession(sessionID)
    }
    if (!session) return jsonError(404, 'session not found')
    return c.json(session)
  })

  app.patch('/session/:sessionID', async (c) => {
    const sessionID = c.req.param('sessionID')
    const body = await c.req.json<{ title?: string; permission?: unknown; time?: { archived?: number } }>()
    if (body.title) {
      await bridge.client.rename(sessionID, body.title).catch(() => {})
    }
    const session = bridge.store.getSession(sessionID) ?? {
      id: sessionID,
      slug: sessionID,
      projectID: '',
      directory: bridge.store.directory,
      title: body.title ?? sessionID.slice(0, 12),
      version: '0',
      time: { created: Date.now(), updated: Date.now() },
      project: null,
    }
    if (body.title) session.title = body.title
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

  app.get('/session/:sessionID/message/:messageID', async (c) => {
    const sessionID = c.req.param('sessionID')
    const messageID = c.req.param('messageID')
    const message = bridge.store.getMessages(sessionID).find((info) => info.id === messageID)
    if (!message) return jsonError(404, 'message not found')
    return c.json({ info: message, parts: bridge.store.getParts(sessionID, messageID) })
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

  app.get('/permission', (c) => c.json(bridge.listPermissions()))
  app.post('/permission/:requestID/reply', async (c) => {
    const requestID = c.req.param('requestID')
    const body = await c.req.json<{ reply?: 'once' | 'always' | 'reject'; message?: string }>()
    if (!body.reply) return jsonError(400, 'reply is required')
    await bridge.replyPermission(requestID, body.reply)
    return c.json(true)
  })

  app.get('/question', (c) => c.json(bridge.listQuestions()))
  app.post('/question/:requestID/reply', async (c) => {
    const requestID = c.req.param('requestID')
    const body = await c.req.json<{ answers?: string[][] }>()
    await bridge.replyQuestion(requestID, body.answers ?? [])
    return c.json(true)
  })
  app.post('/question/:requestID/reject', async (c) => {
    const requestID = c.req.param('requestID')
    await bridge.rejectQuestion(requestID)
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

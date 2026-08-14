import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Box, useApp, useInput } from 'ink'
import { Store } from '../store.ts'
import { Agent, QuestionCenter } from '../agent.ts'
import { HarnessDriver } from '../harness/driver.ts'
import { CordisDriver } from '../cordis/driver.ts'
import type { HarnessClient } from '../harness/client.ts'
import type { CliConfig } from '../config.ts'
import { appendEvent, createSession, listSessions, replaySession } from '../sessions.ts'
import type { ToolDef } from '../tools/types.ts'
import type { SessionDriver, SessionMeta, TodoItem } from '../types.ts'
import { ChatPane } from './ChatPane.tsx'
import { Sidebar, type SidebarTab } from './Sidebar.tsx'
import { StatusBar } from './StatusBar.tsx'
import { InputBar } from './InputBar.tsx'
import { QuestionModal } from './QuestionModal.tsx'
import { theme } from '../theme.ts'

/** In-process cordis mode (dsh --profile cli): drive the host agent directly. */
export interface CordisMode {
  ctx: unknown
  agent: unknown
  model: string
  questionCenter: QuestionCenter
  sessionId: string
}

export function App({
  store,
  config,
  initialSessionId,
  tools,
  harness,
  cordis,
}: {
  store: Store
  config: CliConfig
  initialSessionId?: string
  tools?: ToolDef[]
  /** When set, the session is driven by a live harness web instance. */
  harness?: HarnessClient
  /** When set, the session is driven in-process by a host agent (cordis plugin). */
  cordis?: CordisMode
}) {
  const state = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
  const { exit } = useApp()

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [focus, setFocus] = useState<'chat' | 'sidebar'>('chat')
  const [tab, setTab] = useState<SidebarTab>('sessions')
  const [selIndex, setSelIndex] = useState(0)
  const [sessionId, setSessionId] = useState<string>(initialSessionId ?? '')
  const driverRef = useRef<SessionDriver | null>(null)
  const currentIdRef = useRef<string>(initialSessionId ?? '')

  const refreshList = useCallback(() => {
    if (harness) {
      void harness
        .listSessions()
        .then(({ items }) => {
          const metas: SessionMeta[] = items.map((s) => ({
            id: s.sessionId,
            title: s.sessionId.slice(0, 12),
            createdAt: 0,
            updatedAt: s.updatedAt,
            messageCount: 0,
            model: '',
          }))
          store.setSessionList(metas)
        })
        .catch(() => {})
      return
    }
    store.setSessionList(listSessions())
  }, [harness, store])

  const mountSession = useCallback(
    (id: string | null) => {
      driverRef.current?.abort('session-switch')
      const questionCenter = new QuestionCenter(store, false)

      if (cordis) {
        // ── cordis plugin mode: drive the host agent in-process ──
        const driver = new CordisDriver({
          ctx: cordis.ctx,
          agent: cordis.agent,
          store,
          questionCenter: cordis.questionCenter,
          sessionId: cordis.sessionId,
          model: cordis.model,
          cwd: config.cwd,
        })
        driver.subscribe()
        driverRef.current = driver
        currentIdRef.current = cordis.sessionId
        setSessionId(cordis.sessionId)
        store.reset({ sessionId: cordis.sessionId, title: 'Session', model: cordis.model })
        store.setSessionList([
          { id: cordis.sessionId, title: cordis.sessionId.slice(0, 12), createdAt: 0, updatedAt: Date.now(), messageCount: 0, model: '' },
        ])
        return
      }

      if (harness) {
        // ── connected mode: drive a harness session ──
        const driver = new HarnessDriver({
          client: harness,
          store,
          questionCenter,
          sessionId: id ?? '',
          cwd: config.cwd,
          model: config.model,
          onTitle: () => refreshList(),
        })
        driverRef.current = driver
        currentIdRef.current = id ?? ''
        setSessionId(id ?? '')
        store.reset({ sessionId: id ?? '', title: 'Session', model: config.model })
        if (id) void driver.loadHistory()
        driver.startListening()
        if (!id) {
          // fresh session — ask the harness to create one
          void harness
            .createSession(config.cwd)
            .then(({ sessionId: sid }) => {
              driver.sessionId = sid
              currentIdRef.current = sid
              setSessionId(sid)
              void driver.loadHistory()
              refreshList()
            })
            .catch((e) => store.handleEvent({ type: 'error', message: (e as Error).message }))
        }
        refreshList()
        return
      }

      // ── standalone mode: local agent ──
      const fresh = id === null
      const data = fresh
        ? { meta: {} as SessionMeta, messages: [], todos: [], planMode: false }
        : replaySession(id)
      const model = (data.meta.model as string) || config.model
      const agent = new Agent({
        config,
        store,
        tools,
        sink: {
          emit: (ev) => store.handleEvent(ev),
          persist: (ev) => {
            if (currentIdRef.current) appendEvent(currentIdRef.current, ev as never)
          },
          questionCenter,
        },
        sessionId: currentIdRef.current,
        cwd: config.cwd,
        model,
        planMode: data.planMode,
        onTitle: () => refreshList(),
      })
      agent.loadMessages(data.messages)
      driverRef.current = agent
      const id2 = fresh ? createSession(config.model, config.cwd).id : id
      currentIdRef.current = id2
      agent.sessionId = id2
      setSessionId(id2)
      store.reset({
        messages: data.messages,
        todos: data.todos,
        planMode: data.planMode,
        sessionId: id2,
        title: data.meta.title ?? 'New session',
        model,
      })
      refreshList()
    },
    [config, store, refreshList, tools, harness, cordis],
  )

  useEffect(() => {
    mountSession(initialSessionId ?? null)
    return () => {
      driverRef.current?.abort('exit')
    }
  }, [mountSession, initialSessionId])

  // keep the sidebar list fresh when a title lands
  useEffect(() => {
    if (state.title) refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.title])

  const busy = state.busy
  const hasQuestion = state.questions.length > 0

  const send = useCallback(
    (textOverride?: string) => {
      const text = (textOverride ?? input).trim()
      if (!text || busy || hasQuestion) return
      setHistory((h) => [...h, text])
      setHistIdx(-1)
      setInput('')
      const driver = driverRef.current
      if (driver) void driver.sendUser(text)
    },
    [input, busy, hasQuestion],
  )

  const histUp = useCallback(() => {
    if (history.length === 0) return
    const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1)
    setHistIdx(next)
    setInput(history[next] as string)
  }, [history, histIdx])

  const histDown = useCallback(() => {
    if (histIdx === -1) return
    const next = histIdx + 1
    if (next >= history.length) {
      setHistIdx(-1)
      setInput('')
    } else {
      setHistIdx(next)
      setInput(history[next] as string)
    }
  }, [history, histIdx])

  const newSession = useCallback(() => {
    if (busy) return
    mountSession(null)
    setFocus('chat')
  }, [busy, mountSession])

  const togglePlan = useCallback(() => {
    if (busy) return
    driverRef.current?.togglePlanMode()
  }, [busy])

  const toggleTodo = useCallback(
    (id: string) => {
      const driver = driverRef.current
      if (!driver) return
      const next = state.todos.map((t) => {
        if (t.id !== id) return t
        const status: TodoItem['status'] =
          t.status === 'pending' ? 'in_progress' : t.status === 'in_progress' ? 'completed' : 'pending'
        return { ...t, status }
      })
      driver.updateTodos(next)
    },
    [state.todos],
  )

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === 'c') {
      const driver = driverRef.current
      if (driver && (busy || hasQuestion || state.status === 'question')) {
        driver.abort('interrupted by user')
      } else {
        exit()
      }
      return
    }
    if (hasQuestion) return // modal owns the keys
    if (key.ctrl && inputKey === 'n') {
      newSession()
      return
    }
    if (key.ctrl && inputKey === 'e') {
      togglePlan()
      return
    }
    if (key.ctrl && inputKey === 'm') {
      driverRef.current?.cycleModel()
      return
    }
    if (key.ctrl && inputKey === 'r') {
      setFocus('sidebar')
      setTab('sessions')
      return
    }
    if (key.ctrl && inputKey === 'l') {
      setInput('')
      return
    }
    if (key.tab) {
      setFocus((f) => (f === 'chat' ? 'sidebar' : 'chat'))
      setSelIndex(0)
      return
    }
    if (key.escape) {
      if (input) setInput('')
      else if (focus === 'sidebar') setFocus('chat')
      return
    }
    if (focus === 'chat' && key.upArrow && !input) histUp()
    if (focus === 'chat' && key.downArrow && !input) histDown()
  })

  const activeQuestion = hasQuestion ? (state.questions[0] as NonNullable<typeof state.questions[0]>) : null

  return (
    <Box flexDirection="row" height="100%">
      <Sidebar
        focused={focus === 'sidebar'}
        tab={tab}
        onTab={setTab}
        sessions={state.sessionList}
        currentSessionId={sessionId}
        selIndex={selIndex}
        onSelectIndex={setSelIndex}
        onOpenSession={(id) => {
          mountSession(id)
          setFocus('chat')
        }}
        todos={state.todos}
        onToggleTodo={toggleTodo}
        planMode={state.planMode}
        onTogglePlan={togglePlan}
      />
      <Box flexDirection="column" flexGrow={1}>
        <ChatPane messages={state.messages} focused={focus === 'chat'} status={state.status} />
        <Box paddingX={1} flexShrink={0}>
          <InputBar
            value={input}
            onChange={setInput}
            onSubmit={send}
            disabled={focus !== 'chat' || busy || hasQuestion}
            busy={busy}
            placeholder={harness ? 'Ask the harness… (Ctrl+N new · Ctrl+M model)' : 'Ask dskharness anything… (Ctrl+E plan · Ctrl+N new · Ctrl+M model)'}
          />
        </Box>
        <StatusBar
          model={state.model || config.model}
          status={state.status}
          detail={state.statusDetail}
          planMode={state.planMode}
          usage={state.usage}
          cwd={config.cwd}
          sessionTitle={state.title}
        />
      </Box>
      {activeQuestion ? <QuestionModal question={activeQuestion} /> : null}
    </Box>
  )
}

export function buildApp(
  store: Store,
  config: CliConfig,
  initialSessionId?: string,
  tools?: ToolDef[],
  harness?: HarnessClient,
  cordis?: CordisMode,
) {
  return (
    <App store={store} config={config} initialSessionId={initialSessionId} tools={tools} harness={harness} cordis={cordis} />
  )
}

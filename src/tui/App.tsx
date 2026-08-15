import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
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
import { InputBar } from './InputBar.tsx'
import { MiniWhale } from './Whale.tsx'
import { QuestionModal } from './QuestionModal.tsx'
import { CommandPanel, PALETTE_COMMANDS, filterCommands, type PaletteMode } from './CommandPanel.tsx'
import { theme } from '../theme.ts'

/** In-process cordis mode (dsh --profile cli): drive the host agent directly. */
export interface CordisMode {
  ctx: unknown
  agent: unknown
  model: string
  questionCenter: QuestionCenter
  sessionId: string
}

interface Panel {
  mode: 'sessions' | 'todos' | 'help' | 'tools' | 'skills' | 'jobs' | 'status' | 'models'
  selected: number
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
  const inputRef = useRef('')
  /** setInput that keeps a ref in sync (slash commands read it synchronously). */
  const setInputBoth = useCallback((v: string | ((p: string) => string)) => {
    const next = typeof v === 'function' ? (v as (p: string) => string)(inputRef.current) : v
    inputRef.current = next
    setInput(next)
  }, [])
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [sessionId, setSessionId] = useState<string>(initialSessionId ?? '')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [cmdSel, setCmdSel] = useState(0)
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

      // standalone
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

  // keep the session list fresh when a title lands
  useEffect(() => {
    if (state.title) refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.title])

  const busy = state.busy
  const hasQuestion = state.questions.length > 0

  const filteredGroups = useMemo(() => {
    const q = input.startsWith('/') ? input.slice(1) : ''
    return filterCommands(q)
  }, [input])
  const [panelText, setPanelText] = useState<string | null>(null)
  const [modelsList, setModelsList] = useState<Array<{ provider: string; id: string }>>([])
  const [clearSignal, setClearSignal] = useState(0)

  const showCommands = input.startsWith('/') && !panel
  const panelLen = panel
    ? panel.mode === 'sessions'
      ? Math.min(20, state.sessionList.length)
      : panel.mode === 'todos'
        ? state.todos.length
        : panel.mode === 'models'
          ? modelsList.length
          : 1
    : filteredGroups.flatMap((g) => g.commands).length

  const send = useCallback(
    (textOverride?: string) => {
      const text = (textOverride ?? input).trim()
      if (!text || busy || hasQuestion) return
      if (text.startsWith('/')) return // slash commands are handled by the palette
      setHistory((h) => [...h, text])
      setHistIdx(-1)
      setInputBoth('')
      const driver = driverRef.current
      if (driver) void driver.sendUser(text)
    },
    [input, busy, hasQuestion],
  )

  const histUp = useCallback(() => {
    if (history.length === 0) return
    const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1)
    setHistIdx(next)
    setInputBoth(history[next] as string)
  }, [history, histIdx])

  const histDown = useCallback(() => {
    if (histIdx === -1) return
    const next = histIdx + 1
    if (next >= history.length) {
      setHistIdx(-1)
      setInputBoth('')
    } else {
      setHistIdx(next)
      setInputBoth(history[next] as string)
    }
  }, [history, histIdx])

  const newSession = useCallback(() => {
    if (busy) return
    mountSession(null)
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

  /** Run the selected slash command. */
  const runCommand = useCallback(async (rawInput?: string) => {
    // The keystroke may carry the whole pasted command (text+Enter in one
    // chunk) before React state catches up; prefer it when it contains a '/'.
    const src = rawInput && rawInput.includes('/') ? rawInput : inputRef.current
    // Resolve the command by its name from the static table — this is immune
    // to stale filteredGroups/cmdSel during same-chunk keystrokes.
    const name = src.replace(/^\//, '').split(/\s+/)[0]?.toLowerCase() ?? ''
    const all = filteredGroups.flatMap((g) => g.commands)
    const cmd = (name ? PALETTE_COMMANDS.find((c) => c.name === name) : undefined) ?? all[cmdSel]
    if (!cmd) return
    const arg = src.replace(/^\/\w+\s*/, '')
    setInputBoth('')
    setCmdSel(0)
    const driver = driverRef.current
    const showText = (text: string, mode: 'status' | 'tools' | 'skills' | 'jobs' = 'status') => {
      setPanelText(text)
      setPanel({ mode, selected: 0 })
    }
    switch (cmd.name) {
      case 'sessions':
        setPanel({ mode: 'sessions', selected: 0 })
        break
      case 'todos':
        setPanel({ mode: 'todos', selected: 0 })
        break
      case 'new':
        newSession()
        break
      case 'plan':
        togglePlan()
        break
      case 'agent':
        if (driver?.planMode) driver.togglePlanMode()
        break
      case 'models': {
        setModelsList([])
        setPanel({ mode: 'models', selected: 0 })
        if (harness) {
          try {
            const cat = (await harness.models(currentIdRef.current)) as {
              groups?: Array<{ id: string; models: Array<{ id: string }> }>
            }
            setModelsList(cat.groups?.flatMap((g) => g.models.map((m) => ({ provider: g.id, id: m.id }))) ?? [])
          } catch {
            /* keep empty */
          }
        } else {
          setModelsList([
            { provider: 'deepseek', id: 'deepseek-chat' },
            { provider: 'deepseek', id: 'deepseek-reasoner' },
          ])
        }
        break
      }
      case 'model':
        if (arg && driver) driver.setModel(arg)
        else showText('usage: /model <name>')
        break
      case 'rename':
        if (arg && driver?.renameSession) await driver.renameSession(arg)
        else showText('usage: /rename <title>')
        break
      case 'fork': {
        const id = driver?.forkSession ? await driver.forkSession() : undefined
        if (id) mountSession(id)
        else if (!driver?.forkSession) showText('fork is not supported in this mode')
        break
      }
      case 'resume':
        if (arg) mountSession(arg)
        else showText('usage: /resume <session-id>')
        break
      case 'compact': {
        const r = driver?.compactContext ? await driver.compactContext() : 'not supported in this mode'
        showText(String(r))
        break
      }
      case 'clear':
        setClearSignal((n) => n + 1)
        break
      case 'goal': {
        const r = driver?.goalText ? await driver.goalText() : 'not supported in this mode'
        showText(String(r))
        break
      }
      case 'tools':
        showText(driver?.listTools?.() ?? '—', 'tools')
        break
      case 'skills':
        showText(driver?.listSkills?.() ?? '—', 'skills')
        break
      case 'jobs':
        showText(driver?.listJobs?.() ?? '—', 'jobs')
        break
      case 'status':
        showText(String(driver?.sessionStatus?.() ?? '—'))
        break
      case 'help':
        setPanel({ mode: 'help', selected: 0 })
        break
      case 'exit':
        exit()
        break
    }
  }, [filteredGroups, cmdSel, inputRef, newSession, togglePlan, exit, harness, mountSession, setInputBoth])

  /** Confirm the open panel (sessions / todos / help). */
  const confirmPanel = useCallback(() => {
    if (!panel) return
    if (panel.mode === 'sessions') {
      const s = state.sessionList[panel.selected]
      if (s) mountSession(s.id)
      setPanel(null)
      setInputBoth('')
      return
    }
    if (panel.mode === 'todos') {
      const t = state.todos[panel.selected]
      if (t) toggleTodo(t.id)
      return
    }
    if (panel.mode === 'models') {
      const m = modelsList[panel.selected]
      if (m) driverRef.current?.setModel(m.id)
      setPanel(null)
      setInputBoth('')
      return
    }
    setPanel(null)
    setInputBoth('')
  }, [panel, state.sessionList, state.todos, modelsList, mountSession, toggleTodo, setInputBoth])

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
    if (panel) {
      // Typing a new slash command while a panel is open leaves the panel and
      // runs the command instead of confirming the panel selection.
      const enteringNewCommand = inputRef.current.startsWith('/') || inputKey.startsWith('/')
      if (enteringNewCommand) {
        setPanel(null)
        if (key.return || inputKey.includes('\r') || inputKey.includes('\n')) {
          runCommand(inputKey.includes('/') ? inputKey : inputRef.current)
        }
        return
      }
      if (key.upArrow) setPanel((p) => (p ? { ...p, selected: Math.max(0, p.selected - 1) } : p))
      else if (key.downArrow) setPanel((p) => (p ? { ...p, selected: Math.min(panelLen - 1, p.selected + 1) } : p))
      else if (key.return || inputKey.includes('\r') || inputKey.includes('\n')) confirmPanel()
      else if (key.escape) {
        setPanel(null)
        setInputBoth('')
      }
      return
    }
    // Slash palette is active when the input (past keystroke or committed
    // state) starts with '/'. Using the keystroke keeps pasted "cmd\r"
    // chunks working before React state catches up.
    const queryActive = inputRef.current.startsWith('/') || inputKey.startsWith('/') || inputKey.includes('/')
    if (queryActive) {
      if (key.return || inputKey.includes('\r') || inputKey.includes('\n')) {
        runCommand(inputKey.includes('/') ? inputKey : inputRef.current)
        return
      }
      if (key.upArrow) setCmdSel((s) => Math.max(0, s - 1))
      else if (key.downArrow) setCmdSel((s) => Math.min(filteredGroups.flatMap((g) => g.commands).length - 1, s + 1))
      else if (key.escape) setInputBoth('')
      return // other keys edit the query via InputBar's onChange
    }
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
    if (key.ctrl && inputKey === 'l') {
      setInputBoth('')
      return
    }
    if (key.escape) {
      if (input) setInputBoth('')
      return
    }
    if (key.upArrow && !input) histUp()
    if (key.downArrow && !input) histDown()
  })

  const activeQuestion = hasQuestion ? (state.questions[0] as NonNullable<typeof state.questions[0]>) : null

  return (
    <Box flexDirection="column" height="100%">
      <Box paddingX={1} height={1} flexShrink={0}>
        <Text>
          <Text color={theme.primary} bold>
            ✦ dskharness
          </Text>
          <Text dimColor>
            {' · '}
            {state.title || 'new session'}
          </Text>
          {state.planMode && (
            <Text color={theme.plan} bold>
              {' '}◆ PLAN
            </Text>
          )}
          <Text dimColor>
            {' · '}
            {state.model || config.model}
            {' · '}
            {shortPath(config.cwd)}
          </Text>
          {busy && (
            <Text dimColor>
              {' · '}
              {state.status}
            </Text>
          )}
          {busy ? <MiniWhale /> : null}
        </Text>
      </Box>
      <ChatPane messages={state.messages} focused status={state.status} clearSignal={clearSignal} />
      {showCommands || panel ? (
        <Box paddingX={1} flexShrink={0}>
          <CommandPanel
            mode={panel?.mode ?? 'command'}
            query={input}
            selected={panel?.selected ?? cmdSel}
            groups={filteredGroups}
            sessions={state.sessionList}
            todos={state.todos}
            currentSessionId={sessionId}
            planMode={state.planMode}
            model={state.model || config.model}
            panelText={panelText ?? undefined}
            modelsList={modelsList}
          />
        </Box>
      ) : null}
      <Box paddingX={1} flexGrow={1} flexShrink={0}>
        <InputBar
          value={input}
          onChange={setInputBoth}
          onSubmit={send}
          disabled={busy || hasQuestion}
          busy={busy}
          placeholder={'Ask anything… ( / for commands )'}
          planMode={state.planMode}
          suppressEnter={showCommands || !!panel}
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

function shortPath(cwd: string): string {
  const home = process.env.HOME ?? ''
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`
  return cwd
}

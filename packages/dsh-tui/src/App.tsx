import { createEffect, createSignal, For, onCleanup } from 'solid-js'
import type { DshTui } from './dsh.ts'
import type { OpenCodeMessage, OpenCodePart, OpenCodeSession } from '@dsh/core'

export function App(props: { dsh: DshTui }) {
  const [sessions, setSessions] = createSignal<OpenCodeSession[]>([])
  const [sessionId, setSessionId] = createSignal<string>('')
  const [messages, setMessages] = createSignal<OpenCodeMessage[]>([])
  const [parts, setParts] = createSignal<Map<string, OpenCodePart[]>>(new Map())
  const [prompt, setPrompt] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [commands, setCommands] = createSignal<Array<{ name: string; description: string; input?: { hint: string } }>>([])

  const refreshSessions = async () => {
    await props.dsh.refreshSessions()
    setSessions(props.dsh.store.listSessions())
  }

  const syncCurrent = () => {
    const id = sessionId()
    if (!id) return
    setMessages(props.dsh.store.getMessages(id))
    const next = new Map<string, OpenCodePart[]>()
    for (const message of props.dsh.store.getMessages(id)) {
      next.set(message.id, props.dsh.store.getParts(id, message.id))
    }
    setParts(next)
  }

  const selectSession = async (id: string) => {
    setSessionId(id)
    await props.dsh.loadHistory(id)
    syncCurrent()
  }

  const send = async () => {
    const text = prompt().trim()
    if (!text || busy()) return
    let id = sessionId()
    if (!id) {
      const created = await props.dsh.createSession()
      id = created.id
      setSessionId(id)
      setSessions(props.dsh.store.listSessions())
    }
    setBusy(true)
    setPrompt('')
    try {
      await props.dsh.prompt(id, text)
      // DSH turns are streamed through events; give the store a beat to update
      // before re-reading the projected transcript.
      setTimeout(() => {
        syncCurrent()
        setBusy(false)
      }, 250)
    } catch (error) {
      setBusy(false)
      console.error(error)
    }
  }

  const executeLine = async (line: string) => {
    const id = sessionId()
    if (!id || !line.startsWith('/')) return false
    await props.dsh.executeCommand(id, line)
    return true
  }

  const submit = async () => {
    if (prompt().startsWith('/') && sessionId()) {
      await executeLine(prompt())
      setPrompt('')
      return
    }
    await send()
  }

  const unsubscribe = props.dsh.subscribe(() => {
    void refreshSessions().catch(() => {})
    syncCurrent()
  })

  createEffect(() => {
    if (!sessionId()) return
    syncCurrent()
  })

  createEffect(() => {
    if (!sessionId() || !prompt().startsWith('/')) {
      setCommands([])
      return
    }
    void props.dsh.listCommands(sessionId()).then(setCommands)
  })

  onCleanup(() => unsubscribe())

  return (
    <box flexDirection="row" height="100%">
      <box
        width={32}
        flexDirection="column"
        border="right"
        borderColor="#3F3F46"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        <text fg="#FF7A1A" bold>
          DeepSeek Harness CLI
        </text>
        <text fg="#A1A1AA">sessions</text>
        <For each={sessions()}>
          {(session) => (
            <text
              fg={session.id === sessionId() ? '#FF7A1A' : '#A1A1AA'}
              onMouseUp={() => void selectSession(session.id)}
            >
              {session.id === sessionId() ? '● ' : '  '}
              {session.title}
            </text>
          )}
        </For>
      </box>

      <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} flexDirection="column" overflow="hidden">
          <For each={messages()}>
            {(message) => (
              <box flexDirection="column" marginTop={1}>
                <text fg={message.role === 'user' ? '#4ADE80' : '#8B9EFF'} bold>
                  {message.role === 'user' ? 'you' : 'dsh'}
                </text>
                <For each={parts().get(message.id) ?? []}>
                  {(part) => (
                    <text fg={part.type === 'tool' ? '#9CA3AF' : '#E4E4E7'} wrapMode="word">
                      {part.type === 'text'
                        ? part.text
                        : part.type === 'reasoning'
                          ? `✢ ${part.text}`
                          : `· ${part.tool}`}
                    </text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>

        {prompt().startsWith('/') && sessionId() ? (
          <box
            flexShrink={0}
            border="round"
            borderColor="#FF7A1A"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            marginBottom={1}
          >
            <text fg="#FF7A1A" bold>
              commands
            </text>
            <For each={commands()}>
              {(command) => (
                <text fg="#A1A1AA">
                  /{command.name}
                  {command.input?.hint ? ` ${command.input.hint}` : ''} — {command.description}
                </text>
              )}
            </For>
          </box>
        ) : null}

        <box
          flexShrink={0}
          border="left"
          borderColor="#FF7A1A"
          backgroundColor="#141414"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <textarea
            placeholder="Ask anything…  ( / for commands )"
            minHeight={1}
            maxHeight={5}
            value={prompt()}
            onContentChange={(value) => setPrompt(value)}
            onSubmit={() => void submit()}
          />
          <box flexDirection="row" justifyContent="space-between">
            <text fg="#A1A1AA">{busy() ? 'working…' : 'Enter send · / commands · Ctrl+C quit'}</text>
            <text fg="#6B7280">DeepSeek Harness CLI</text>
          </box>
        </box>
      </box>
    </box>
  )
}

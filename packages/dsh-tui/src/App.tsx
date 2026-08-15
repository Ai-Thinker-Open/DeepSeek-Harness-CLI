// @ts-nocheck
import { createEffect, createSignal, For, onCleanup } from 'solid-js'
import { useKeyboard, useRenderer } from '@opentui/solid'
import type { DshRuntime } from './dsh.ts'
import type { OpenCodeMessage, OpenCodeModelOption, OpenCodePart, OpenCodeQuestion, OpenCodeSession, OpenCodeTodo } from '@dsh/core'
import { MessageView } from './MessageView.tsx'
import { QuestionDialog } from './QuestionDialog.tsx'
import { SessionListDialog } from './SessionListDialog.tsx'
import { ModelDialog } from './ModelDialog.tsx'

export function App(props: { dsh: DshRuntime; initialSessionId?: string; continueLatest?: boolean }) {
  const renderer = useRenderer()
  const [sessions, setSessions] = createSignal<OpenCodeSession[]>([])
  const [sessionId, setSessionId] = createSignal<string>('')
  const [messages, setMessages] = createSignal<OpenCodeMessage[]>([])
  const [parts, setParts] = createSignal<Map<string, OpenCodePart[]>>(new Map())
  const [questions, setQuestions] = createSignal<OpenCodeQuestion[]>([])
  const [todos, setTodos] = createSignal<OpenCodeTodo[]>([])
  const [prompt, setPrompt] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [commands, setCommands] = createSignal<Array<{ name: string; description: string; input?: { hint: string } }>>([])
  const [commandSel, setCommandSel] = createSignal(0)
  const [sessionSel, setSessionSel] = createSignal(0)
  const [sessionDialog, setSessionDialog] = createSignal(false)
  const [dialogSel, setDialogSel] = createSignal(0)
  const [modelDialog, setModelDialog] = createSignal(false)
  const [modelSel, setModelSel] = createSignal(0)
  const [models, setModels] = createSignal<OpenCodeModelOption[]>([])
  const [currentModel, setCurrentModel] = createSignal('')

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
    setQuestions(props.dsh.store.getQuestions(id))
    setTodos(props.dsh.store.getTodos(id))
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
    if (!line.startsWith('/')) return false
    if (line === '/models') {
      await openModels()
      return true
    }
    if (line === '/sessions') {
      setDialogSel(0)
      setSessionDialog(true)
      return true
    }
    if (line.startsWith('/rename')) {
      const title = line.replace(/^\/rename\s*/, '').trim()
      if (id && title) {
        await props.dsh.renameSession(id, title)
        await refreshSessions()
      }
      return true
    }
    if (!id) return false
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

  const answerQuestion = async (question: OpenCodeQuestion, option: string) => {
    await props.dsh.answerQuestion(question.id, question.sessionID, option)
    syncCurrent()
  }

  const cancelQuestion = (question: OpenCodeQuestion) => {
    void props.dsh.cancelQuestion(question.id, question.sessionID).then(syncCurrent)
  }

  const openModels = async () => {
    const id = sessionId()
    if (!id) return
    const list = await props.dsh.listModels(id)
    setModels(list)
    setModelSel(0)
    setCurrentModel(props.dsh.store.getSession(id)?.title ?? '')
    setModelDialog(true)
  }

  const selectModel = async (model: OpenCodeModelOption) => {
    const id = sessionId()
    if (!id) return
    await props.dsh.selectModel(id, model.provider, model.id)
    setCurrentModel(model.id)
    setModelDialog(false)
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      if (busy()) {
        const id = sessionId()
        if (id) void props.dsh.abort(id)
        setBusy(false)
      } else {
        renderer.destroy()
      }
      return
    }

    if (sessionDialog()) {
      if (key.name === 'up') {
        setDialogSel((index) => Math.max(0, index - 1))
      } else if (key.name === 'down') {
        setDialogSel((index) => Math.min(sessions().length - 1, index + 1))
      } else if (key.name === 'return') {
        const selected = sessions()[dialogSel()]
        if (selected) {
          setSessionDialog(false)
          void selectSession(selected.id)
        }
      } else if (key.name === 'escape') {
        setSessionDialog(false)
      }
      return
    }

    if (modelDialog()) {
      if (key.name === 'up') {
        setModelSel((index) => Math.max(0, index - 1))
      } else if (key.name === 'down') {
        setModelSel((index) => Math.min(models().length - 1, index + 1))
      } else if (key.name === 'return') {
        const selected = models()[modelSel()]
        if (selected) void selectModel(selected)
      } else if (key.name === 'escape') {
        setModelDialog(false)
      }
      return
    }

    if (key.ctrl && key.name === 'r') {
      setDialogSel(0)
      setSessionDialog(true)
      return
    }

    if (key.ctrl && key.name === 'm') {
      void openModels()
      return
    }

    if (key.ctrl && key.name === 'n') {
      void createNewSession()
      return
    }

    if (prompt() === '') {
      if (key.name === 'down' && sessions().length > 0) {
        setSessionSel((index) => Math.min(sessions().length - 1, index + 1))
        return
      }
      if (key.name === 'up' && sessions().length > 0) {
        setSessionSel((index) => Math.max(0, index - 1))
        return
      }
      if (key.name === 'return' && sessions()[sessionSel()]) {
        void selectSession(sessions()[sessionSel()]!.id)
        return
      }
    }

    if (!prompt().startsWith('/') || !sessionId() || commands().length === 0) return
    if (key.name === 'up') {
      setCommandSel((index) => Math.max(0, index - 1))
    } else if (key.name === 'down') {
      setCommandSel((index) => Math.min(commands().length - 1, index + 1))
    } else if (key.name === 'escape') {
      setPrompt('')
      setCommandSel(0)
    } else if (key.name === 'return') {
      const selected = commands()[commandSel()]
      if (selected) {
        void executeLine(`/${selected.name}`)
        setPrompt('')
        setCommandSel(0)
      }
    }
  })

  const createNewSession = async () => {
    const created = await props.dsh.createSession()
    setSessionId(created.id)
    setSessions(props.dsh.store.listSessions())
    setSessionSel(0)
    syncCurrent()
  }

  const unsubscribe = props.dsh.subscribe(() => {
    void refreshSessions().catch(() => {})
    syncCurrent()
  })

  let bootstrapped = false
  createEffect(() => {
    if (bootstrapped) return
    bootstrapped = true
    void refreshSessions()
      .then(() => {
        const list = props.dsh.store.listSessions()
        const target = props.initialSessionId
          ? list.find((session) => session.id === props.initialSessionId)
          : props.continueLatest
            ? list[0]
            : undefined
        if (target) void selectSession(target.id)
      })
      .catch(() => {})
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
    const clientCommands = [
      { name: 'models', description: 'Select model' },
      { name: 'sessions', description: 'Switch session' },
      { name: 'rename', description: 'Rename current session', input: { hint: '<title>' } },
    ]
    void props.dsh.listCommands(sessionId()).then((hostCommands) => setCommands([...clientCommands, ...hostCommands]))
  })

  onCleanup(() => unsubscribe())

  const activeQuestion = questions()[0]

  return (
    <>
      {sessionDialog() ? (
        <SessionListDialog
          sessions={sessions()}
          currentId={sessionId()}
          selected={dialogSel()}
          onSelect={(session) => {
            setSessionDialog(false)
            void selectSession(session.id)
          }}
          onClose={() => setSessionDialog(false)}
        />
      ) : null}
      {modelDialog() ? (
        <ModelDialog
          models={models()}
          currentModel={currentModel()}
          selected={modelSel()}
          onSelect={(model) => void selectModel(model)}
          onClose={() => setModelDialog(false)}
        />
      ) : null}
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
          {(session, index) => (
            <text
              fg={session.id === sessionId() ? '#FF7A1A' : index() === sessionSel() ? '#FFFFFF' : '#A1A1AA'}
              backgroundColor={session.id !== sessionId() && index() === sessionSel() ? '#27272A' : undefined}
              onMouseUp={() => void selectSession(session.id)}
            >
              {session.id === sessionId() ? '● ' : '  '}
              {session.title}
            </text>
          )}
        </For>
        <text fg="#A1A1AA" marginTop={1}>
          tasks
        </text>
        <For each={todos()}>
          {(todo) => (
            <text fg={todo.status === 'completed' ? '#4ADE80' : todo.status === 'in_progress' ? '#FBBF24' : '#A1A1AA'}>
              {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '›' : '·'} {todo.content}
            </text>
          )}
        </For>
      </box>

      <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} flexDirection="column" overflow="hidden">
          <For each={messages()}>
            {(message) => (
              <MessageView message={message} parts={parts().get(message.id) ?? []} />
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
              {(command, index) => (
                <text
                  fg={index() === commandSel() ? '#111111' : '#A1A1AA'}
                  backgroundColor={index() === commandSel() ? '#FF7A1A' : undefined}
                >
                  {index() === commandSel() ? '› ' : '  '}
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
      {activeQuestion ? (
        <QuestionDialog
          question={activeQuestion}
          onAnswer={(option) => void answerQuestion(activeQuestion, option)}
          onCancel={() => cancelQuestion(activeQuestion)}
        />
      ) : null}
    </>
  )
}

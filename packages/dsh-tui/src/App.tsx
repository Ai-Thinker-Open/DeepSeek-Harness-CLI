import { createSignal } from 'solid-js'

export function App() {
  const [prompt, setPrompt] = createSignal('')

  return (
    <box flexDirection="column" height="100%" paddingLeft={2} paddingRight={2}>
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <box flexDirection="column" alignItems="center">
          <text fg="#FF7A1A" bold>
            DeepSeek Harness
          </text>
          <text fg="#A1A1AA">DeepSeek Harness CLI</text>
        </box>
      </box>
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
          placeholder="Ask anything…"
          minHeight={1}
          maxHeight={5}
          value={prompt()}
          onContentChange={(value) => setPrompt(value)}
        />
        <box flexDirection="row" justifyContent="space-between">
          <text fg="#A1A1AA">Enter send · / commands · Ctrl+C quit</text>
          <text fg="#6B7280">DeepSeek Harness CLI</text>
        </box>
      </box>
    </box>
  )
}

import type { WireMessage, WireToolCall, WireToolDef } from './types.ts'

export interface StreamCallbacks {
  onContent?: (delta: string) => void
  onReasoning?: (delta: string) => void
  onToolCallDelta?: (delta: { index: number; id?: string; name?: string; argsDelta?: string }) => void
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
}

export interface StreamResult {
  finishReason: string | null
  content: string
  reasoning: string
  toolCalls: WireToolCall[]
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export interface ChatRequest {
  model: string
  messages: WireMessage[]
  tools?: WireToolDef[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Stream a chat completion from an OpenAI-compatible endpoint (DeepSeek). */
export async function streamChat(
  baseUrl: string,
  apiKey: string,
  req: ChatRequest,
  cb: StreamCallbacks,
): Promise<StreamResult> {
  const isReasoner = req.model.includes('reasoner')
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = 'auto'
  }
  // deepseek-reasoner does not accept temperature/top_p.
  if (!isReasoner && typeof req.temperature === 'number') body.temperature = req.temperature
  if (typeof req.maxTokens === 'number') body.max_tokens = req.maxTokens

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      detail = j.error?.message || ''
    } catch {
      detail = (await res.text()).slice(0, 500)
    }
    const hint =
      res.status === 401
        ? ' (set DEEPSEEK_API_KEY or add apiKey to ~/.dskharness/config.json)'
        : res.status === 402
          ? ' (DeepSeek balance insufficient)'
          : res.status === 429
            ? ' (rate limited — retry in a moment)'
            : ''
    throw new ApiError(res.status, `API ${res.status}: ${detail || res.statusText}${hint}`)
  }

  if (!res.body) throw new Error('API returned no body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | null = null
  let content = ''
  let reasoning = ''
  let usage: StreamResult['usage']
  const toolCalls = new Map<number, { id: string; name: string; args: string }>()

  const flushLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return
    let chunk: {
      choices?: Array<{
        delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<Record<string, unknown>> }
        finish_reason?: string | null
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    try {
      chunk = JSON.parse(payload)
    } catch {
      return
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      }
    }
    const choice = chunk.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) return
    if (delta.content) {
      content += delta.content
      cb.onContent?.(delta.content)
    }
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content
      cb.onReasoning?.(delta.reasoning_content)
    }
    for (const tc of delta.tool_calls ?? []) {
      const index = (tc.index as number | undefined) ?? 0
      const call = toolCalls.get(index) ?? { id: '', name: '', args: '' }
      if (typeof tc.id === 'string' && tc.id) call.id = tc.id
      const fn = tc.function as { name?: string; arguments?: string } | undefined
      if (fn?.name) call.name += fn.name
      if (fn?.arguments) call.args += fn.arguments
      toolCalls.set(index, call)
      cb.onToolCallDelta?.({ index, id: tc.id as string | undefined, name: fn?.name, argsDelta: fn?.arguments })
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      flushLine(line)
    }
  }
  if (buffer.trim()) flushLine(buffer)

  if (usage) cb.onUsage?.(usage)

  const calls: WireToolCall[] = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.name, arguments: c.args },
    }))

  return { finishReason, content, reasoning, toolCalls: calls, usage }
}

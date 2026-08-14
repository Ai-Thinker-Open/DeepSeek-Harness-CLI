/**
 * Mock OpenAI-compatible chat completions server for testing dsh-cli headless.
 * - First request (no tool results yet): streams reasoning_content, then a
 *   bash tool call, finish_reason=tool_calls.
 * - Later requests (tool results present): streams reasoning, then a final
 *   text answer echoing the tool result.
 */
import http from 'node:http'

const port = Number(process.env.PORT || 18765)
const SLOW = process.env.MOCK_SLOW === '1'
const sleep = (ms) => new Promise((r) => setTimeout(r, SLOW ? ms * 10 : ms))

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  let body = ''
  for await (const c of req) body += c
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400)
    res.end('bad json')
    return
  }
  const messages = parsed.messages ?? []
  const hasToolResult = messages.some((m) => m.role === 'tool')
  const model = parsed.model ?? 'mock'

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n')
  const delta = (d) =>
    send({ id: 'mock', object: 'chat.completion.chunk', created: Date.now(), model, choices: [{ index: 0, delta: d }] })
  const usage = { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 }

  // reasoning phase (tests the whale/thinking path)
  for (const t of ['The whale dives, ', 'bubbles rise, ', 'and I compose an answer.']) {
    delta({ reasoning_content: t })
    await sleep(15)
  }

  if (!hasToolResult) {
    // first turn: request a tool call driven by the prompt keywords
    const firstUser = String(parsed.messages.find((m) => m.role === 'user')?.content ?? '')
    let toolCall
    if (/plan/i.test(firstUser) && !/deny/i.test(firstUser)) {
      toolCall = { name: 'exit_plan_mode', args: JSON.stringify({ plan: '1. Research\n2. Write code\n3. Test' }) }
    } else if (/subagent/i.test(firstUser)) {
      toolCall = { name: 'subagent', args: JSON.stringify({ prompt: 'do the subtask' }) }
    } else if (/workflow/i.test(firstUser)) {
      toolCall = {
        name: 'workflow',
        args: JSON.stringify({
          meta: { name: 'wf-test' },
          script: 'const r = await parallel([() => agent("task a"), () => agent("task b")]); return { count: r.filter(Boolean).length, log: typeof log };',
        }),
      }
    } else if (/mcp/i.test(firstUser)) {
      toolCall = { name: 'mcp__mock__echo', args: JSON.stringify({ message: 'hello-from-mcp' }) }
    } else {
      toolCall = { name: 'bash', args: JSON.stringify({ command: 'echo hello-from-mock-bash' }) }
    }
    delta({ content: null })
    delta({ tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: toolCall.name, arguments: toolCall.args } }] })
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  // final turn: answer, echoing the tool result
  const toolMsg = messages.find((m) => m.role === 'tool')
  const echo = String(toolMsg?.content ?? '').slice(0, 80)
  for (const t of ['All done. The tool returned: ', echo]) {
    delta({ content: t })
    await sleep(15)
  }
  send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })
  res.write('data: [DONE]\n\n')
  res.end()
})

server.listen(port, () => console.log(`mock llm on http://127.0.0.1:${port}`))

import { expect, test } from "bun:test"
import type { SessionEvent } from "../src/harness/client"
import type { ChatMessage } from "../src/session"
import {
  assistantBlocksToMessage,
  blockText,
  eventToMessage,
  foldHistory,
  foldToolCall,
  foldToolResult,
  MAX_TOOL_OUTPUT_CHARS,
  tryParseArgs,
  userMessageText,
} from "../src/harness/fold"

const ev = (type: string, data: Record<string, unknown>, seq: number, time = seq * 1000): SessionEvent => ({
  type,
  seq,
  time,
  data,
})

test("assistantBlocksToMessage extracts text, reasoning and tool calls", () => {
  const { content, thinking, toolCalls } = assistantBlocksToMessage(
    [
      { type: "reasoning", text: "let me think" },
      { type: "text", text: "hello" },
      { type: "tool-call", id: "c1", name: "bash", arguments: JSON.stringify({ command: "ls" }) },
    ],
    "turn-1",
  )
  expect(content).toBe("hello")
  expect(thinking).toBe("let me think")
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0]).toMatchObject({ id: "c1", name: "bash", status: "ok", summary: "ls" })
})

test("eventToMessage folds user and assistant messages", () => {
  const user = eventToMessage(ev("user/message", { id: "m1", content: [{ type: "text", text: "你好" }] }, 1))
  expect(user).toMatchObject({ id: "msg-m1", role: "user", content: "你好" })
  expect(user?.inject).toBeUndefined()

  const assistant = eventToMessage(
    ev("assistant/message", { message: { id: "m2", content: [{ type: "text", text: "收到" }] } }, 2),
  )
  expect(assistant).toMatchObject({ id: "msg-m2", role: "assistant", content: "收到" })

  const empty = eventToMessage(ev("assistant/message", { message: { content: [] } }, 3))
  expect(empty).toBeNull()
})

test("eventToMessage folds injected context into a context-injection block", () => {
  const system = eventToMessage(
    ev(
      "user/message",
      {
        id: "inj-1",
        content: [{ type: "text", text: "你是编码助手" }],
        source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "instructions" },
      },
      1,
    ),
  )
  expect(system).toMatchObject({
    id: "msg-inj-1",
    role: "user",
    content: "你是编码助手",
    inject: { source: "@deepseek-ai/dsh-system-prompt", form: "instructions" },
  })

  const catalog = eventToMessage(
    ev(
      "user/message",
      {
        id: "inj-2",
        content: [{ type: "text", text: "技能目录" }],
        source: { kind: "plugin", plugin: "skill-catalog", form: "catalog" },
      },
      2,
    ),
  )
  expect(catalog?.inject).toMatchObject({ source: "skill-catalog", form: "catalog" })

  const notice = eventToMessage(
    ev(
      "user/message",
      {
        id: "inj-3",
        content: [{ type: "text", text: "文件已变更" }],
        source: { kind: "plugin", plugin: "dsh-fs", form: "notice", summary: "src/app.tsx 已更新" },
      },
      3,
    ),
  )
  expect(notice?.inject).toMatchObject({ source: "dsh-fs", form: "notice", summary: "src/app.tsx 已更新" })

  // Unknown plugin kinds still fold with a best-effort title.
  const unknown = eventToMessage(
    ev("user/message", { id: "inj-4", content: [{ type: "text", text: "x" }], source: { kind: "plugin", plugin: "" } }, 4),
  )
  expect(unknown?.inject?.source).toBe("unknown")
})

test("foldHistory replays tool calls and results onto assistant messages", () => {
  const events: SessionEvent[] = [
    ev("user/message", { id: "m1", content: [{ type: "text", text: "查一下" }] }, 1),
    ev(
      "assistant/message",
      { message: { id: "m2", content: [{ type: "tool-call", id: "c1", name: "bash", arguments: JSON.stringify({ command: "echo hi" }) }] } },
      2,
    ),
    ev("tool/call", { callId: "c1", name: "bash", arguments: JSON.stringify({ command: "echo hi" }) }, 3),
    ev(
      "tool/result",
      { message: { content: [{ type: "tool-result", toolCallId: "c1", isError: false, content: [{ type: "text", text: "hi" }] }] } },
      4,
    ),
  ]
  const messages = foldHistory(events)
  expect(messages).toHaveLength(2)
  const assistant = messages[1]
  expect(assistant?.toolCalls?.[0]).toMatchObject({ id: "c1", name: "bash", status: "ok" })
  expect(assistant?.toolResults?.[0]).toMatchObject({ toolCallId: "c1", ok: true, output: "hi" })
})

test("foldToolCall and foldToolResult attach live status to the latest assistant message", () => {
  const messages: ChatMessage[] = [
    { id: "m1", role: "user" as const, content: "x", createdAt: 1 },
    { id: "m2", role: "assistant" as const, content: "", createdAt: 2 },
  ]

  foldToolCall(messages, ev("tool/call", { callId: "c1", name: "bash", arguments: JSON.stringify({ command: "ls" }) }, 3))
  expect(messages[1]?.toolCalls?.[0]).toMatchObject({ id: "c1", name: "bash", status: "running" })

  foldToolResult(
    messages,
    ev("tool/result", { message: { content: [{ type: "tool-result", toolCallId: "c1", isError: true, content: [{ type: "text", text: "boom" }] }] } }, 4),
  )
  expect(messages[1]?.toolCalls?.[0]?.status).toBe("error")
  expect(messages[1]?.toolResults?.[0]).toMatchObject({ toolCallId: "c1", ok: false, output: "boom" })
})

test("tryParseArgs and helpers handle bad input", () => {
  expect(tryParseArgs("not json")).toEqual({})
  expect(blockText(undefined)).toBe("")
  expect(blockText([{ type: "image" }])).toBe("[image]")
  expect(userMessageText(ev("user/message", { content: [{ type: "text", text: "ping" }] }, 1))).toBe("ping")
})

test("tool results are truncated at fold time", () => {
  const big = "x".repeat(MAX_TOOL_OUTPUT_CHARS + 100)
  const messages: ChatMessage[] = [
    { id: "m1", role: "user" as const, content: "x", createdAt: 1 },
    {
      id: "m2",
      role: "assistant" as const,
      content: "",
      createdAt: 2,
      toolCalls: [{ id: "c1", name: "bash", args: {}, status: "running" as const }],
    },
  ]
  foldToolResult(
    messages,
    ev(
      "tool/result",
      { message: { content: [{ type: "tool-result", toolCallId: "c1", isError: false, content: [{ type: "text", text: big }] }] } },
      3,
    ),
  )
  expect(messages[1]?.toolResults?.[0]).toMatchObject({
    toolCallId: "c1",
    ok: true,
    truncated: true,
  })
  expect(messages[1]?.toolResults?.[0]?.output.length).toBe(MAX_TOOL_OUTPUT_CHARS)
})

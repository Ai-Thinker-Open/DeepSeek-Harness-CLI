/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SessionScreen } from "../src/screens/session"
import { EMPTY_STATS, type ChatMessage, type HarnessQuestion, type SessionStats } from "../src/session"

const userMsg = (content: string): ChatMessage => ({ id: `u-${content}`, role: "user", content, createdAt: 1 })
const assistantMsg = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `a-${content}`,
  role: "assistant",
  content,
  createdAt: 2,
  ...extra,
})

async function renderSession(opts: {
  messages?: ChatMessage[]
  stats?: SessionStats
  statusText?: string
  height?: number
  question?: () => HarnessQuestion | null
  onQuestion?: (choice: string) => void
  onBack?: () => void
  onSend?: (text: string) => void
} = {}) {
  const app = await testRender(
    () => (
      <SessionScreen
        messages={() => opts.messages ?? []}
        mode={() => "workspace-write"}
        model={() => "DeepSeek-V4-Flash"}
        toast={() => null}
        stats={() => opts.stats ?? EMPTY_STATS}
        statusText={() => opts.statusText ?? ""}
        question={opts.question ?? (() => null)}
        onSend={opts.onSend ?? (() => {})}
        onBack={opts.onBack ?? (() => {})}
        onQuestion={opts.onQuestion ?? (() => {})}
      />
    ),
    { width: 80, height: opts.height ?? 32 },
  )
  return app
}

test("session screen renders messages and model without a top header", async () => {
  const app = await renderSession({
    messages: [userMsg("你好"), assistantMsg("收到，演示回复")],
  })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("你好")
  expect(frame).toContain("收到，演示回复")
  expect(frame).toContain("DeepSeek-V4-Flash")
  expect(frame).not.toContain("esc 返回")
  expect(frame).toContain("给智能体发消息")
  expect(frame).not.toContain("ls -la")
})

test("escape in the session returns home", async () => {
  let backed = false
  const app = await renderSession({
    messages: [userMsg("你好")],
    onBack: () => {
      backed = true
    },
  })
  await app.renderOnce()

  app.mockInput.pressEscape()
  // A lone ESC is ambiguous for the terminal parser, so it dispatches after a short timeout.
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()

  expect(backed).toBe(true)
})

test("hovering the stats bar shows real stats without flickering", async () => {
  const stats: SessionStats = {
    turns: 3,
    steps: 12,
    llmMs: 83_000,
    toolMs: 12_500,
    inTokens: 1_200,
    outTokens: 800,
    cacheReadTokens: 11_800,
    cacheWriteTokens: 120,
    reasoningTokens: 60,
    firstTokenMs: 2_500,
    firstTokenSumMs: 2_500,
    firstTokenCount: 1,
  }
  const app = await renderSession({
    messages: [userMsg("你好")],
    stats,
  })
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("3 轮"))
  const x = lines[y]?.indexOf("3 轮") ?? 0

  await app.mockMouse.moveTo(x + 1, y)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("轮次 3")
  expect(app.captureCharFrame()).toContain("输入 1.2k tokens")

  // Staying over the row must keep the popup stable, not flicker it away.
  for (let i = 0; i < 3; i++) {
    await app.mockMouse.moveTo(x + 2 + i, y)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("轮次 3")
  }

  await app.mockMouse.moveTo(x + 1, 2)
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("轮次 3")
})

test("status text sits above the prompt and never hides the stats row", async () => {
  const stats: SessionStats = {
    turns: 3,
    steps: 3,
    llmMs: 6_000,
    toolMs: 1_000,
    inTokens: 732,
    outTokens: 492,
    cacheReadTokens: 23_668,
    cacheWriteTokens: 0,
    reasoningTokens: 60,
    firstTokenMs: 900,
    firstTokenSumMs: 2_700,
    firstTokenCount: 3,
  }
  const app = await renderSession({
    messages: [userMsg("你好")],
    stats,
    statusText: "Deep diving",
  })
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const statusY = lines.findIndex((line) => line.includes("Deep diving"))
  const statsY = lines.findIndex((line) => line.includes("3 轮 · 3 步"))
  const promptY = lines.findIndex((line) => line.includes("Workspace write"))

  expect(app.captureCharFrame()).toContain("Deep diving")
  // Deep-diving status is followed by the chasing-lights animation.
  expect(app.captureCharFrame()).toContain("●")
  expect(app.captureCharFrame()).toContain("○")
  expect(statusY).toBeGreaterThanOrEqual(0)
  expect(statsY).toBeGreaterThan(statusY)
  expect(promptY).toBeGreaterThan(statusY)
  expect(app.captureCharFrame()).toContain("首 token 平均 0.9s")
  expect(app.captureCharFrame()).toContain("缓存命中 97%")
  // The row is longer than the 80-column test frame, so the token segment
  // wraps onto its own line — assert it as a whole.
  expect(app.captureCharFrame()).toContain("24.4k · 输出 492 tok")
})

test("assistant messages collapse thinking and render tool cards", async () => {
  const messages: ChatMessage[] = [
    userMsg("查一下"),
    assistantMsg("", {
      thinking: "让我想想\n第二行",
      toolCalls: [
        {
          id: "c1",
          name: "bash",
          args: { command: "echo hi" },
          summary: "echo hi",
          status: "running",
          startedAt: 2,
        },
      ],
      streaming: true,
    }),
    assistantMsg("完成", {
      toolCalls: [
        {
          id: "c2",
          name: "bash",
          args: { command: "ls" },
          summary: "ls",
          status: "ok",
          startedAt: 3,
          finishedAt: 3_400,
        },
      ],
      toolResults: [{ toolCallId: "c2", ok: true, output: "src\ntest\nREADME.md" }],
    }),
  ]
  const app = await renderSession({ messages })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("✦")
  expect(frame).toContain("Think")
  expect(frame).not.toContain("点击展开")
  expect(frame).not.toContain("行 ·")
  expect(frame).toContain("运行中…")
  expect(frame).toContain("●")
  expect(frame).toContain("echo hi")
  expect(frame).toContain("✓")
  expect(frame).toContain("src")
  expect(frame).toContain("test")

  // Thinking body stays collapsed until clicked.
  expect(frame).not.toContain("让我想想")
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("Think"))
  const x = lines[y]?.indexOf("Think") ?? 0
  await app.mockMouse.click(x + 1, y)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("让我想想")
})

test("assistant markdown renders blocks and inline styles without raw markers", async () => {
  const content = `## 🖥️ 终端类（和你的环境很搭）

1. **终端小游戏** — 用 ANSI 转义序列或 TUI 库实现
2. **终端天气/汇率查询工具** — 调用免费 API
3. 命令行 **Markdown 浏览器** — 支持翻页、搜索

\`\`\`bash
echo "hello-from-md"
\`\`\`

> 引用：\`bun run dev\` 启动

| 名称 | 说明 |
| --- | --- |
| bash | 执行命令 |
| fs | 读写文件 |

- 写代码 / 改代码：在这个工作区里创建、修改、调试项目
- 查资料：搜索最新的技术信息、文档
- 分析问题：排查 bug、审查代码`
  const app = await renderSession({ messages: [assistantMsg(content)], height: 48 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("终端类（和你的环境很搭）")
  expect(frame).toContain("终端小游戏")
  expect(frame).toContain("Markdown 浏览器")
  expect(frame).toContain("echo \"hello-from-md\"")
  expect(frame).toContain("引用：bun run dev 启动")
  expect(frame).toContain("bash")
  expect(frame).toContain("执行命令")
  // Unordered list items render as bullet dots, not raw dash markers.
  expect(frame).toContain("• 写代码 / 改代码：在这个工作区里创建、修改、调试项目")
  expect(frame).not.toContain("- 写代码 / 改代码")
  // Markdown syntax markers must not leak into the frame.
  expect(frame).not.toContain("## 🖥️")
  expect(frame).not.toContain("**终端小游戏**")
  expect(frame).not.toContain("**Markdown 浏览器**")
  expect(frame).not.toContain("```")
})

test("injected context renders collapsed and expands on click", async () => {
  const messages: ChatMessage[] = [
    {
      id: "i1",
      role: "user",
      content: "你是 DeepSeek Harness CLI 的编码助手。",
      inject: { source: "@deepseek-ai/dsh-system-prompt", form: "instructions" },
      createdAt: 1,
    },
    {
      id: "i2",
      role: "user",
      content: "技能目录：\n- bash\n- fs",
      inject: { source: "skill-catalog", form: "catalog" },
      createdAt: 2,
    },
    userMsg("你好"),
  ]
  const app = await renderSession({ messages })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("❐")
  expect(frame).toContain("上下文注入")
  expect(frame).toContain("@deepseek-ai/dsh-system-prompt")
  expect(frame).toContain("skill-catalog")
  expect(frame).toContain("指令")
  expect(frame).toContain("目录")
  expect(frame).toContain("你好")
  // Collapsed by default: the injected body is hidden until clicked.
  expect(frame).not.toContain("你是 DeepSeek Harness CLI 的编码助手。")

  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("@deepseek-ai/dsh-system-prompt"))
  const x = lines[y]?.indexOf("@deepseek-ai/dsh-system-prompt") ?? 0
  await app.mockMouse.click(x + 1, y)
  await app.renderOnce()

  expect(app.captureCharFrame()).toContain("你是 DeepSeek Harness CLI 的编码助手。")
})

test("question modal answers with the selected option", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "允许执行 bash 吗？",
    detail: "command: echo hi",
    options: ["Yes", "No"],
    kind: "permission",
  })
  const answered: string[] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onQuestion: (choice) => {
      answered.push(choice)
      setCurrent(null)
    },
  })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("Permission")
  expect(frame).toContain("允许执行 bash 吗？")
  expect(frame).toContain("Yes")
  expect(frame).toContain("No")

  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(answered).toEqual(["Yes"])
  expect(app.captureCharFrame()).not.toContain("Permission")
})

test("question modal escape chooses the last option", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "允许执行 bash 吗？",
    options: ["Yes", "No"],
    kind: "permission",
  })
  const answered: string[] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onQuestion: (choice) => {
      answered.push(choice)
      setCurrent(null)
    },
  })
  await app.renderOnce()

  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()
  expect(answered).toEqual(["No"])
})

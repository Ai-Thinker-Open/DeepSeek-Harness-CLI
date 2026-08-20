/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SessionScreen } from "../src/screens/session"
import { EMPTY_STATS, type ChatMessage, type HarnessQuestion, type SessionStats } from "../src/session"
import type { CommandItem } from "../src/commands"
import type { CommandResultView } from "../src/commands"
import type { QueueAction, QueueItem } from "../src/harness/client"

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
  planMode?: () => boolean
  planPending?: () => boolean
  height?: number
  question?: () => HarnessQuestion | null
  onQuestion?: (choice: string) => void
  onBack?: () => void
  onSend?: (text: string) => void
  commandItems?: () => CommandItem[]
  onCommand?: (line: string) => Promise<CommandResultView | null>
  queue?: () => QueueItem[]
  onQueueAction?: (itemId: string, action: QueueAction) => void
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
        planMode={opts.planMode ?? (() => false)}
        planPending={opts.planPending ?? (() => false)}
        question={opts.question ?? (() => null)}
        onSend={opts.onSend ?? (() => {})}
        onBack={opts.onBack ?? (() => {})}
        onQuestion={opts.onQuestion ?? (() => {})}
        commandItems={opts.commandItems}
        onCommand={opts.onCommand}
        queue={opts.queue}
        onQueueAction={opts.onQueueAction}
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

test("session screen shows a Plan mode badge above the composer", async () => {
  const app = await renderSession({
    messages: [userMsg("任务")],
    planMode: () => true,
  })
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).toContain("Plan mode")
})

test("pending plan transition renders the muted Plan mode… badge", async () => {
  const app = await renderSession({
    planMode: () => false,
    planPending: () => true,
  })
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).toContain("Plan mode…")
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
  expect(frame).not.toContain("运行中…")
  expect(frame).toContain("Bash · echo hi")
  expect(frame).toContain("echo hi")
  expect(frame).toContain("Bash · ls")
  // Tool cards are collapsed by default; output stays hidden until expanded.
  expect(frame).not.toContain("src")
  expect(frame).not.toContain("test")

  // Thinking body stays collapsed until clicked.
  expect(frame).not.toContain("让我想想")
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("Think"))
  const x = lines[y]?.indexOf("Think") ?? 0
  await app.mockMouse.click(x + 1, y)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("让我想想")

  // Expanding the settled tool card reveals its output.
  const frame2 = app.captureCharFrame().split("\n")
  const ty = frame2.findIndex((line) => line.includes("· ls"))
  const tx = frame2[ty]?.indexOf("· ls") ?? 0
  await app.mockMouse.click(tx + 1, ty)
  await app.renderOnce()
  const frame3 = app.captureCharFrame()
  expect(frame3).toContain("src")
  expect(frame3).toContain("test")
})

test("tool cards render per-variant bodies (bash exit code, edit diff, todo checklist)", async () => {
  const messages: ChatMessage[] = [
    assistantMsg("", {
      toolCalls: [
        {
          id: "t1",
          name: "bash",
          args: { command: "false", description: "Run a failing command" },
          summary: "Run a failing command",
          status: "ok",
          startedAt: 2,
          finishedAt: 2300,
        },
        {
          id: "t2",
          name: "edit",
          args: { file_path: "src/main.ts", old_string: "旧代码", new_string: "新代码" },
          summary: "src/main.ts",
          status: "ok",
          startedAt: 3,
          finishedAt: 3300,
        },
        {
          id: "t3",
          name: "todo_write",
          args: {
            todos: [
              { content: "调研", status: "completed" },
              { content: "实现", status: "in_progress" },
              { content: "测试", status: "pending" },
            ],
          },
          summary: "",
          status: "ok",
          startedAt: 4,
          finishedAt: 4300,
        },
      ],
      toolResults: [
        { toolCallId: "t1", ok: true, output: "boom\n[exit code: 1]" },
        {
          toolCallId: "t2",
          ok: true,
          output: "done",
          meta: { card: "diff", diffs: [{ path: "src/main.ts", oldText: "OLD", newText: "NEW" }] },
        },
      ],
    }),
  ]
  const app = await renderSession({ messages, height: 40 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  // Variant titles and summaries.
  expect(frame).toContain("Bash · Run a failing command")
  expect(frame).toContain("Edit · src/main.ts")
  expect(frame).toContain("Todo · 1/3 done · 1 running")
  // Exit marker is not shown raw in the collapsed row.
  expect(frame).not.toContain("[exit code: 1]")

  const lines = frame.split("\n")
  const bashY = lines.findIndex((line) => line.includes("Bash ·"))
  await app.mockMouse.click(lines[bashY]!.indexOf("Bash") + 1, bashY)
  await app.renderOnce()
  const afterBash = app.captureCharFrame()
  expect(afterBash).toContain("❯ false")
  expect(afterBash).toContain("boom")
  expect(afterBash).toContain("✗ 退出码 1")
  expect(afterBash).not.toContain("[exit code: 1]")

  const lines2 = afterBash.split("\n")
  const editY = lines2.findIndex((line) => line.includes("Edit ·"))
  await app.mockMouse.click(lines2[editY]!.indexOf("Edit") + 1, editY)
  await app.renderOnce()
  const afterEdit = app.captureCharFrame()
  // Structured meta diffs win over args-derived old/new text.
  expect(afterEdit).toContain("- OLD")
  expect(afterEdit).toContain("+ NEW")
  expect(afterEdit).not.toContain("- 旧代码")
  expect(afterEdit).toContain("src/main.ts")

  const lines3 = afterEdit.split("\n")
  const todoY = lines3.findIndex((line) => line.includes("Todo ·"))
  await app.mockMouse.click(lines3[todoY]!.indexOf("Todo") + 1, todoY)
  await app.renderOnce()
  const afterTodo = app.captureCharFrame()
  expect(afterTodo).toContain("☑ 调研")
  expect(afterTodo).toContain("◐ 实现")
  expect(afterTodo).toContain("○ 测试")
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
    {
      id: "i3",
      role: "user",
      content: "工作区快照",
      inject: { source: "workspace", form: "snapshot" },
      createdAt: 3,
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
  expect(frame).toContain("workspace")
  // Snapshot injections render without a form label.
  expect(frame).not.toContain("快照")
  expect(frame).not.toContain("· snapshot")
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

test("command cards render in the message window and expand on click", async () => {
  const messages: ChatMessage[] = [
    {
      id: "cmd1",
      role: "user",
      content: "/compact",
      command: { commandId: "c1", name: "compact", status: "ok", resultText: "已压缩历史" },
      createdAt: 1,
    },
  ]
  const app = await renderSession({ messages })
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).toContain("/compact")
  // Collapsed by default; the result text shows after clicking.
  expect(frame).not.toContain("已压缩历史")
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("/compact"))
  const x = lines[y]?.indexOf("/compact") ?? 0
  await app.mockMouse.click(x + 1, y)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("已压缩历史")
})

test("pending message dock renders queued rows with action icons", async () => {
  const app = await renderSession({
    messages: [userMsg("hi")],
    queue: () => [
      { id: "q1", messageId: "m1", placement: "queued", text: "排队消息", preview: "排队消息" },
    ],
  })
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).not.toContain("待处理消息")
  expect(frame).toContain("排队消息")
  expect(frame).toContain("▸")
  expect(frame).toContain("✎")
  expect(frame).toContain("✕")
  expect(frame).toContain("➤")
})

test("pending message preview collapses to one line and expands on click", async () => {
  const longPreview =
    "这是一条很长的排队消息，用来验证预览在默认状态下只显示一行，点击之后才会展开显示完整内容，尾部文字：结尾标记"
  const tail = "尾部文字：结尾标记"
  const app = await renderSession({
    messages: [userMsg("hi")],
    queue: () => [
      { id: "q1", messageId: "m1", placement: "queued", text: longPreview, preview: longPreview },
    ],
  })
  await app.renderOnce()

  const collapsed = app.captureCharFrame()
  expect(collapsed).toContain("这是一条很长的排队消息")
  expect(collapsed).not.toContain(tail)

  const lines = collapsed.split("\n")
  const y = lines.findIndex((line) => line.includes("这是一条很长的排队消息"))
  const x = lines[y]?.indexOf("这是一条很长的排队消息") ?? 0
  await app.mockMouse.click(x + 1, y)
  await app.renderOnce()

  const expanded = app.captureCharFrame()
  expect(expanded).toContain(tail)
  expect(expanded).toContain("▾")

  const expandedLines = expanded.split("\n")
  const tailY = expandedLines.findIndex((line) => line.includes(tail))
  const tailX = expandedLines[tailY]?.indexOf(tail) ?? 0
  await app.mockMouse.click(tailX + 1, tailY)
  await app.renderOnce()

  const collapsedAgain = app.captureCharFrame()
  expect(collapsedAgain).not.toContain(tail)
  expect(collapsedAgain).toContain("▸")
})

test("slash popup filters commands and runs a local command", async () => {
  let ran = ""
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "sessions", description: "列出会话", kind: "local", behavior: "run" },
      { name: "help", description: "显示命令", kind: "local", behavior: "run" },
    ],
    onCommand: async (line) => {
      ran = line
      return line === "/sessions" ? { title: "会话列表", rows: ["s-1  运行中"] } : null
    },
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  app.mockInput.typeText("sess")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  const filtered = app.captureCharFrame()
  expect(filtered).toContain("/sessions")
  expect(filtered).not.toContain("/help")

  app.mockInput.pressEnter() // no-argument command runs immediately
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(ran).toBe("/sessions")
  expect(frame).toContain("会话列表")
  expect(frame).toContain("s-1  运行中")
})

test("slash menu Enter fills argument-taking commands instead of running them", async () => {
  let ran = ""
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "plan", description: "描述任务以生成计划", kind: "host", input: { hint: "[<任务|off>]" }, behavior: "fill" },
      { name: "sessions", description: "列出会话", kind: "local", behavior: "run" },
    ],
    onCommand: async (line) => {
      ran = line
      return null
    },
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  app.mockInput.typeText("plan")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  app.mockInput.pressEnter() // "/plan <任务>" needs args: fill, don't run
  await new Promise((resolve) => setTimeout(resolve, 50))
  await app.renderOnce()
  expect(ran).toBe("")
  expect(app.captureCharFrame()).toContain("/plan ")
})

test("slash menu tab-completes the command and Enter dispatches the full line", async () => {
  let ran = ""
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "plan", description: "描述任务以生成计划", kind: "host", input: { hint: "[<任务描述|off>]" }, behavior: "fill" },
      { name: "permission", description: "权限模式", kind: "host", behavior: "fill" },
    ],
    onCommand: async (line) => {
      ran = line
      return null
    },
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  app.mockInput.typeText("pl")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/plan")

  app.mockInput.pressTab()
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  // Tab completes "/plan " with a trailing space and closes the menu.
  expect(app.captureCharFrame()).not.toContain("▸ /plan")

  app.mockInput.typeText("重构")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/plan 重构")

  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await app.renderOnce()
  expect(ran).toBe("/plan 重构")
})

test("slash menu scrolls the selection window past the ten-row limit", async () => {
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () =>
      Array.from({ length: 14 }, (_, i) => ({
        name: `cmd${i + 1}`,
        description: `desc-${i + 1}`,
        kind: "local" as const,
        behavior: "run" as const,
      })),
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/cmd1")

  // Eleven downs move the selection past the 10-row window; the window follows.
  for (let i = 0; i < 11; i++) {
    app.mockInput.pressArrow("down")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  const scrolled = app.captureCharFrame()
  expect(scrolled).toContain("/cmd12")
  expect(scrolled).not.toContain("/cmd1 ")
  expect(scrolled).toContain("↑/↓ 滚动")
})

test("slash menu mouse click runs no-argument commands immediately", async () => {
  let ran = ""
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "sessions", description: "列出会话", kind: "local", behavior: "run" },
      { name: "help", description: "显示命令", kind: "local", behavior: "run" },
    ],
    onCommand: async (line) => {
      ran = line
      return null
    },
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("/help"))
  const x = lines[y]?.indexOf("/help") ?? 0
  await app.mockMouse.click(x + 1, y)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await app.renderOnce()

  expect(ran).toBe("/help")
})

test("slash menu mouse click fills argument-taking commands like Enter", async () => {
  let ran = ""
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "plan", description: "描述任务以生成计划", kind: "host", behavior: "fill" },
      { name: "sessions", description: "列出会话", kind: "local", behavior: "run" },
    ],
    onCommand: async (line) => {
      ran = line
      return null
    },
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("/plan"))
  const x = lines[y]?.indexOf("/plan") ?? 0
  await app.mockMouse.click(x + 1, y)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await app.renderOnce()

  // Same as Enter: "/plan " is filled for arguments, nothing runs yet.
  expect(ran).toBe("")
  expect(app.captureCharFrame()).toContain("/plan ")
})

test("slash menu mouse wheel moves the selection", async () => {
  let ran = ""
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () =>
      Array.from({ length: 14 }, (_, i) => ({
        name: `cmd${i + 1}`,
        description: `desc-${i + 1}`,
        kind: "local" as const,
        behavior: "run" as const,
      })),
    onCommand: async (line) => {
      ran = line
      return null
    },
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/cmd1")

  const lines = app.captureCharFrame().split("\n")
  // Scroll over the menu's top padding row so the wheel event lands on the
  // container (no synthetic hover resets the selection in the test driver).
  const firstRowY = lines.findIndex((line) => line.includes("/cmd1"))
  const y = Math.max(0, firstRowY - 1)
  // The container's left padding column (inside the border) so the wheel
  // event lands on the menu box itself.
  const x = 2
  for (let i = 0; i < 3; i++) {
    await app.mockMouse.scroll(x + 1, y, "down")
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
  await app.renderOnce()

  app.mockInput.pressEnter() // no-argument command runs immediately
  await new Promise((resolve) => setTimeout(resolve, 50))
  await app.renderOnce()
  expect(ran).toBe("/cmd4")
})

test("slash menu highlight follows the selection and spans the row", async () => {
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "sessions", description: "列出会话", kind: "local", behavior: "run" },
      { name: "resume", description: "浏览会话", kind: "local", behavior: "run" },
      { name: "help", description: "显示命令", kind: "local", behavior: "run" },
    ],
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()

  const primaryBgWidth = (needle: string): number => {
    const frame = app.captureSpans()
    const line = frame.lines.find((l) => l.spans.some((s) => s.text.includes(needle)))
    if (!line) return 0
    const isPrimaryBg = (s: { bg?: { r: number; g: number; b: number } }) =>
      s.bg !== undefined &&
      Math.abs(s.bg.r - 77 / 255) < 0.02 &&
      Math.abs(s.bg.g - 107 / 255) < 0.02 &&
      Math.abs(s.bg.b - 254 / 255) < 0.02
    return line.spans
      .filter(isPrimaryBg)
      .reduce((sum, s) => sum + s.text.length, 0)
  }

  expect(primaryBgWidth("/sessions")).toBeGreaterThan(0)
  expect(primaryBgWidth("/resume")).toBe(0)

  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  expect(primaryBgWidth("/sessions")).toBe(0)
  expect(primaryBgWidth("/resume")).toBeGreaterThan(0)
  // The highlight covers the full row, not just the text: at 80 columns the
  // row content box is ~74 cells wide.
  expect(primaryBgWidth("/resume")).toBeGreaterThan(50)
})

test("slash menu aligns descriptions MiMo-style (name column + description)", async () => {
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "sessions", description: "列出主机上的全部会话", kind: "local", behavior: "run" },
      { name: "help", description: "显示全部快捷命令", kind: "local", behavior: "run" },
    ],
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  const row = frame.split("\n").find((line) => line.includes("/sessions")) ?? ""
  const helpRow = frame.split("\n").find((line) => line.includes("/help")) ?? ""
  // Names share one padded column, descriptions start at the same offset and
  // stay inside the panel (no overflow past the right border).
  const sessionsDesc = row.indexOf("列出")
  const helpDesc = helpRow.indexOf("显示")
  expect(row.startsWith("  │")).toBe(true)
  expect(sessionsDesc).toBe(helpDesc)
  expect(row.replace(/\s+$/, "").endsWith("│")).toBe(true)
  expect(helpRow.replace(/\s+$/, "").endsWith("│")).toBe(true)
})

test("slash menu hides input hints and keeps long descriptions inside the panel", async () => {
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      { name: "plan", description: "描述你的任务以生成计划（进入/退出计划模式）", kind: "host", input: { hint: "[<任务描述|off>]" }, behavior: "fill" },
      { name: "goal", description: "设置或查看当前长任务的长期目标", kind: "host", input: { hint: "[<objective>|clear|edit <objective>|pause|resume]" }, behavior: "fill" },
    ],
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  const planRow = frame.split("\n").find((line) => line.includes("/plan")) ?? ""
  const goalRow = frame.split("\n").find((line) => line.includes("/goal")) ?? ""
  // No "[…]" hints anywhere in the menu.
  expect(frame).not.toContain("[<任务描述|off>]")
  expect(frame).not.toContain("[<objective>")
  // Both descriptions stay inside the panel (before its right border).
  expect(planRow.replace(/\s+$/, "").endsWith("│")).toBe(true)
  expect(goalRow.replace(/\s+$/, "").endsWith("│")).toBe(true)
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

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
  busy?: () => boolean
  planMode?: () => boolean
  planPending?: () => boolean
  height?: number
  question?: () => HarnessQuestion | null
  onQuestion?: (choice: string) => void
  onQuestionMany?: (ids: string[]) => void
  onApproval?: (outcome: "allowed-once" | "rejected") => void
  onApprovalAllowSession?: () => void
  onBack?: () => void
  onCancel?: () => void
  onSend?: (text: string) => void
  commandItems?: () => CommandItem[]
  onCommand?: (line: string) => Promise<CommandResultView | null>
  queue?: () => QueueItem[]
  onQueueAction?: (itemId: string, action: QueueAction) => void
  kittyKeyboard?: boolean
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
        busy={opts.busy ?? (() => false)}
        planMode={opts.planMode ?? (() => false)}
        planPending={opts.planPending ?? (() => false)}
        question={opts.question ?? (() => null)}
        onSend={opts.onSend ?? (() => {})}
        onBack={opts.onBack ?? (() => {})}
        onCancel={opts.onCancel ?? (() => {})}
        onQuestion={opts.onQuestion ?? (() => {})}
        onQuestionMany={opts.onQuestionMany}
        onApproval={opts.onApproval}
        onApprovalAllowSession={opts.onApprovalAllowSession}
        commandItems={opts.commandItems}
        onCommand={opts.onCommand}
        queue={opts.queue}
        onQueueAction={opts.onQueueAction}
      />
    ),
    { width: 80, height: opts.height ?? 32, ...(opts.kittyKeyboard ? { kittyKeyboard: true } : {}) },
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

test("escape in plan mode exits plan mode instead of going home", async () => {
  const commands: string[] = []
  let backed = false
  const app = await renderSession({
    messages: [userMsg("任务")],
    planMode: () => true,
    onBack: () => {
      backed = true
    },
    onCommand: async (line) => {
      commands.push(line)
      return null
    },
  })
  await app.renderOnce()

  // The idle plan-mode row hints the affordance next to the badge.
  expect(app.captureCharFrame()).toContain("Esc 退出计划模式")

  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()

  expect(commands).toEqual(["/plan off"])
  expect(backed).toBe(false)
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
  // Not instant: still hidden before the hover delay elapses.
  expect(app.captureCharFrame()).not.toContain("轮次 3")
  // The popup appears after a hover delay, not instantly.
  await new Promise((resolve) => setTimeout(resolve, 650))
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
  expect(frame).toContain("✺")
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

test("thinking row matches tool-row interaction: glyph by default, collapse hint on hover", async () => {
  const messages: ChatMessage[] = [
    assistantMsg("", {
      thinking: "推理内容",
      streaming: true,
    }),
  ]
  const app = await renderSession({ messages })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("✺")
  expect(frame).toContain("Think")
  expect(frame).toContain("…")

  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("Think"))
  const x = lines[y]?.indexOf("Think") ?? 0
  await app.mockMouse.moveTo(x + 1, y)
  await app.renderOnce()

  const hoverFrame = app.captureCharFrame()
  expect(hoverFrame).toContain("▸")
  expect(hoverFrame).not.toContain("✺")
})

test("tool card expand hint only appears while hovering the row", async () => {
  const messages: ChatMessage[] = [
    assistantMsg("", {
      toolCalls: [
        {
          id: "c1",
          name: "bash",
          args: { command: "ls" },
          summary: "ls",
          status: "ok",
          startedAt: 2,
          finishedAt: 3_400,
        },
      ],
      toolResults: [{ toolCallId: "c1", ok: true, output: "src\ntest" }],
    }),
  ]
  const app = await renderSession({ messages })
  await app.renderOnce()

  // No leading collapse icon while the pointer is away.
  const idle = app.captureCharFrame()
  expect(idle).toContain("Bash · ls")
  expect(idle).not.toContain("▸")
  expect(idle).toContain("❯ Bash")

  // Hovering the row swaps the action icon for the collapse icon.
  const lines = idle.split("\n")
  const y = lines.findIndex((line) => line.includes("Bash ·"))
  const x = lines[y]?.indexOf("Bash") ?? 0
  await app.mockMouse.moveTo(x + 1, y)
  await app.renderOnce()
  const hovered = app.captureCharFrame()
  expect(hovered).toContain("▸ Bash")
  expect(hovered).not.toContain("❯ Bash")

  // Moving away hides it again.
  await app.mockMouse.moveTo(1, 31)
  await app.renderOnce()
  const left = app.captureCharFrame()
  expect(left).toContain("❯ Bash")
  expect(left).not.toContain("▸ Bash")
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
  // Edit diff cards auto-expand: the structured change is visible up front
  // and wins over the args-derived old/new text.
  expect(frame).toContain("- OLD")
  expect(frame).toContain("+ NEW")
  expect(frame).not.toContain("- 旧代码")

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
  // A click on the auto-expanded card collapses it (no re-expand).
  expect(afterEdit).not.toContain("- OLD")

  const lines3 = afterEdit.split("\n")
  const todoY = lines3.findIndex((line) => line.includes("Todo ·"))
  await app.mockMouse.click(lines3[todoY]!.indexOf("Todo") + 1, todoY)
  await app.renderOnce()
  const afterTodo = app.captureCharFrame()
  expect(afterTodo).toContain("☑ 调研")
  expect(afterTodo).toContain("◐ 实现")
  expect(afterTodo).toContain("○ 测试")
})

test("edit tool cards auto-expand to show the file change diff", async () => {
  const messages: ChatMessage[] = [
    userMsg("改一下"),
    assistantMsg("完成", {
      toolCalls: [
        {
          id: "e1",
          name: "edit",
          args: { file_path: "src/main.ts", old_string: "OLD", new_string: "NEW" },
          summary: "src/main.ts",
          status: "ok",
          startedAt: 3,
          finishedAt: 3400,
        },
      ],
      toolResults: [
        {
          toolCallId: "e1",
          ok: true,
          output: "The file src/main.ts has been updated successfully.",
          meta: {
            diffs: [
              { path: "src/main.ts", oldText: "OLD", newText: "NEW" },
              { path: "src/main.ts", oldText: null, newText: "INSERTED" },
            ],
          },
        },
      ],
    }),
  ]
  const app = await renderSession({ messages, height: 40 })
  await app.renderOnce()
  await app.renderOnce()

  // The wire meta has no `card` field and the card is expanded by default,
  // so the added/removed lines are visible without clicking.
  const frame = app.captureCharFrame()
  expect(frame).toContain("Edit · src/main.ts")
  expect(frame).toContain("- OLD")
  expect(frame).toContain("+ NEW")
  expect(frame).toContain("+ INSERTED")

  // A manual collapse sticks: the diff does not auto-expand again.
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("Edit ·"))
  await app.mockMouse.click(lines[y]!.indexOf("Edit") + 1, y)
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("- OLD")
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("- OLD")
})

test("adjacent bash cards keep one-row spacing despite newline-ended output", async () => {
  const output = "one\ntwo\n\n"
  const messages: ChatMessage[] = [
    assistantMsg("", {
      toolCalls: [
        {
          id: "b1",
          name: "bash",
          args: { command: "echo one", description: "echo one" },
          summary: "echo one",
          status: "ok",
          startedAt: 2,
          finishedAt: 2200,
        },
        {
          id: "b2",
          name: "bash",
          args: { command: "echo two" },
          summary: "echo two",
          status: "ok",
          startedAt: 3,
          finishedAt: 3200,
        },
      ],
      toolResults: [
        { toolCallId: "b1", ok: true, output },
        { toolCallId: "b2", ok: true, output: "three" },
      ],
    }),
  ]
  const app = await renderSession({ messages, height: 40 })
  await app.renderOnce()

  // Bash cards are collapsed by default: click the first row to expand it so
  // the trailing newlines in its output are visible.
  const before = app.captureCharFrame().split("\n")
  const y = before.findIndex((l) => l.includes("Bash · echo one"))
  await app.mockMouse.click(before[y]!.indexOf("Bash") + 1, y)
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  // The output line is indented inside the card's left border, so match it by
  // content while excluding the second card's header ("Bash · echo two").
  const lastOut = lines.findIndex((l) => l.includes("two") && !l.includes("Bash"))
  const nextBash = lines.findIndex((l, i) => i > lastOut && l.includes("Bash · echo two"))
  expect(lastOut).toBeGreaterThanOrEqual(0)
  expect(nextBash).toBeGreaterThan(lastOut)
  // Only the one-row card margin separates the two cards; the trailing
  // newline in the first output must not render an extra blank row.
  const blankRows = lines.slice(lastOut + 1, nextBash).filter((l) => l.trim() === "")
  expect(blankRows).toHaveLength(1)
})

test("edit diff renders removed lines red and added lines green", async () => {
  const messages: ChatMessage[] = [
    userMsg("改一下"),
    assistantMsg("完成", {
      toolCalls: [
        {
          id: "e1",
          name: "edit",
          args: { file_path: "src/main.ts", old_string: "OLD", new_string: "NEW" },
          summary: "src/main.ts",
          status: "ok",
          startedAt: 3,
          finishedAt: 3400,
        },
      ],
      toolResults: [
        {
          toolCallId: "e1",
          ok: true,
          output: "updated",
          meta: { diffs: [{ path: "src/main.ts", oldText: "OLD", newText: "NEW" }] },
        },
      ],
    }),
  ]
  const app = await renderSession({ messages, height: 40 })
  await app.renderOnce()
  await app.renderOnce()

  const spans = app.captureSpans().lines.flatMap((line) => line.spans)
  const removed = spans.find((s) => s.text.includes("OLD"))
  const added = spans.find((s) => s.text.includes("NEW"))
  const removedSign = spans.find((s) => s.text.trim() === "-")
  const addedSign = spans.find((s) => s.text.trim() === "+")
  expect(removed).toBeDefined()
  expect(added).toBeDefined()
  // Removed content sits on a dark red background (red channel dominant).
  expect(removed!.bg.r).toBeGreaterThan(removed!.bg.g)
  expect(removed!.bg.r).toBeGreaterThan(removed!.bg.b)
  // Added content sits on a dark green background (green channel dominant).
  expect(added!.bg.g).toBeGreaterThan(added!.bg.r)
  expect(added!.bg.g).toBeGreaterThan(added!.bg.b)
  // Sign characters are canonical red (#ef4444) / green (#22c55e).
  expect(removedSign!.fg.r).toBeGreaterThan(0.9)
  expect(removedSign!.fg.g).toBeLessThan(0.3)
  expect(addedSign!.fg.g).toBeGreaterThan(0.7)
  expect(addedSign!.fg.r).toBeLessThan(0.2)
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
  expect(frame).toContain("▤")
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

test("slash menu scrolls one command at a time across category headers", async () => {
  const app = await renderSession({
    messages: [userMsg("hi")],
    commandItems: () => [
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `cmd${i + 1}`,
        description: `d${i + 1}`,
        kind: "local" as const,
        behavior: "run" as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `skill${i + 1}`,
        description: `s${i + 1}`,
        kind: "skill" as const,
        behavior: "run" as const,
      })),
    ],
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  // Nine downs select cmd10; the header consumes a row, so the window has
  // already scrolled to cmd2..cmd10 and cmd1 is gone.
  for (let i = 0; i < 9; i++) {
    app.mockInput.pressArrow("down")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  let frame = app.captureCharFrame()
  expect(frame).not.toContain("/cmd1 ")
  expect(frame).toContain("/cmd10")

  // One more down crosses into the skill section: the 技能 header appears and
  // the window advances by a single command (cmd3..cmd10 + 技能 + skill1).
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  frame = app.captureCharFrame()
  expect(frame).not.toContain("/cmd2 ")
  expect(frame).toContain("/cmd10")
  expect(frame).toContain("/skill1 ")
  expect(frame).toContain("技能")
})

test("slash menu shows 技能 and MCP category headers above their groups", async () => {
  const app = await renderSession({
    commandItems: () => [
      { name: "sessions", description: "列出会话", kind: "local" as const, behavior: "run" as const },
      { name: "wb2-tutorial", description: "技能：WB2 教程", kind: "skill" as const, behavior: "run" as const },
      { name: "flashkey:status", description: "MCP flashkey：设备状态", kind: "mcp" as const, behavior: "run" as const },
    ],
  })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("快捷")
  expect(frame).toContain("技能")
  expect(frame).toContain("MCP")
  expect(frame).toContain("/flashkey:status")
})

test("up/down arrows recall sent-message history like a shell", async () => {
  const sent: string[] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    onSend: (text) => sent.push(text),
  })
  await app.renderOnce()

  app.mockInput.typeText("第一条消息")
  await new Promise((resolve) => setTimeout(resolve, 80))
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  app.mockInput.typeText("第二条消息")
  await new Promise((resolve) => setTimeout(resolve, 80))
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(sent).toEqual(["第一条消息", "第二条消息"])

  // ↑ recalls the newest, then the previous one.
  const emptyCursor = app.captureSpans().cursor[0]
  app.mockInput.pressArrow("up")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("第二条消息")
  // The caret must land at the end of the recalled draft: exactly the width
  // of the recalled text (5 CJK chars = 10 cells) past the empty caret.
  expect(app.captureSpans().cursor[0]).toBe(emptyCursor + 10)
  app.mockInput.pressArrow("up")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("第一条消息")

  // ↓ walks forward, then restores the empty draft.
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("第二条消息")
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("第一条消息")
  expect(app.captureCharFrame()).not.toContain("第二条消息")
})

test("ctrl+enter inserts a newline instead of submitting", async () => {
  const sent: string[] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    onSend: (text) => sent.push(text),
    kittyKeyboard: true,
  })
  await app.renderOnce()

  app.mockInput.typeText("第一行")
  await new Promise((resolve) => setTimeout(resolve, 80))
  app.mockInput.pressEnter({ ctrl: true })
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  app.mockInput.typeText("第二行")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()

  // Ctrl+Enter must not submit; the draft holds both lines.
  expect(sent).toEqual([])
  const frame = app.captureCharFrame()
  expect(frame).toContain("第一行")
  expect(frame).toContain("第二行")

  // A plain Enter submits the multi-line draft.
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(sent).toEqual(["第一行\n第二行"])
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

test("permission modal lists every request as a checkbox", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "权限请求",
    options: ["Allow", "Deny"],
    kind: "permission",
    requests: [
      { id: "q-bash", label: "Bash(ls -la)", suggested: true },
      { id: "q-read", label: "Read(src/app.tsx)", suggested: true },
      { id: "q-edit", label: "Edit(src/theme.ts)", detail: "src/theme.ts", suggested: true },
    ],
  })
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
  })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("Permission")
  expect(frame).toContain("3 个请求")
  expect(frame).toContain("[x] Bash(ls -la)")
  expect(frame).toContain("[x] Read(src/app.tsx)")
  expect(frame).toContain("[x] Edit(src/theme.ts)")
  expect(frame).toContain("Space 切换")
})

test("permission modal space toggles a request and enter submits the selection", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "权限请求",
    options: ["Allow", "Deny"],
    kind: "permission",
    requests: [
      { id: "q-bash", label: "Bash(ls -la)", suggested: true },
      { id: "q-read", label: "Read(src/app.tsx)", suggested: true },
    ],
  })
  const answered: string[][] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onQuestionMany: (ids) => {
      answered.push(ids)
      setCurrent(null)
    },
  })
  await app.renderOnce()

  app.mockInput.pressKey(" ")
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("[ ] Bash(ls -la)")

  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(answered).toEqual([["q-read"]])
  expect(app.captureCharFrame()).not.toContain("Permission")
})

test("permission modal batch keys select none / all / invert / latest", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "权限请求",
    options: ["Allow", "Deny"],
    kind: "permission",
    requests: [
      { id: "q-bash", label: "Bash(ls -la)", suggested: true },
      { id: "q-read", label: "Read(src/app.tsx)", suggested: true },
      { id: "q-edit", label: "Edit(src/theme.ts)", suggested: true },
    ],
  })
  const answered: string[][] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onQuestionMany: (ids) => {
      answered.push(ids)
      setCurrent(null)
    },
  })
  await app.renderOnce()

  // n: none, then i: invert => all three checked again.
  app.mockInput.pressKey("n")
  app.mockInput.pressKey("i")
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("[ ] ")

  // l: only the latest request stays checked.
  app.mockInput.pressKey("l")
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("[x] Edit(src/theme.ts)")
  expect(app.captureCharFrame()).toContain("[ ] Bash(ls -la)")

  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(answered).toEqual([["q-edit"]])
})

test("permission modal escape denies every request", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "权限请求",
    options: ["Allow", "Deny"],
    kind: "permission",
    requests: [
      { id: "q-bash", label: "Bash(ls -la)", suggested: true },
      { id: "q-read", label: "Read(src/app.tsx)", suggested: true },
    ],
  })
  const answered: string[][] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onQuestionMany: (ids) => {
      answered.push(ids)
      setCurrent(null)
    },
  })
  await app.renderOnce()

  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(answered).toEqual([[]])
  expect(app.captureCharFrame()).not.toContain("Permission")
})

test("approval modal allows once on Enter and rejects on escape", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-ap",
    id: "ap-1",
    title: "权限确认",
    detail: "bash · escalate sandbox to danger-full-access: 写回 D 盘",
    options: ["允许本次", "当前会话允许", "拒绝"],
    kind: "permission",
    approval: { id: "ap-1", toolName: "bash", callId: "call_1" },
  })
  const decided: Array<"allowed-once" | "rejected"> = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onApproval: (outcome) => {
      decided.push(outcome)
      setCurrent(null)
    },
  })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("权限确认")
  expect(frame).toContain("写回 D 盘")
  expect(frame).toContain("允许本次")
  expect(frame).toContain("当前会话允许")
  expect(frame).toContain("拒绝")

  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(decided).toEqual(["allowed-once"])

  // Re-open the approval and escape rejects it.
  setCurrent({
    rpcId: "rpc-ap2",
    id: "ap-1",
    title: "权限确认",
    detail: "bash · escalate sandbox to danger-full-access: 写回 D 盘",
    options: ["允许本次", "当前会话允许", "拒绝"],
    kind: "permission",
    approval: { id: "ap-1", toolName: "bash", callId: "call_1" },
  })
  await app.renderOnce()
  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()
  expect(decided).toEqual(["allowed-once", "rejected"])
})

test("approval modal arrow keys pick session-allow or reject", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-ap",
    id: "ap-1",
    title: "权限确认",
    detail: "bash · escalate sandbox to danger-full-access: 写回 D 盘",
    options: ["允许本次", "当前会话允许", "拒绝"],
    kind: "permission",
    approval: { id: "ap-1", toolName: "bash" },
  })
  const decided: Array<"allowed-once" | "rejected"> = []
  let sessionAllowed = 0
  const app = await renderSession({
    messages: [userMsg("你好")],
    question: current,
    onApproval: (outcome) => {
      decided.push(outcome)
      setCurrent(null)
    },
    onApprovalAllowSession: () => {
      sessionAllowed++
      setCurrent(null)
    },
  })
  await app.renderOnce()

  // Down onto "当前会话允许", Enter allows for the session.
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(sessionAllowed).toBe(1)
  expect(decided).toEqual([])

  // Re-open: down twice onto "拒绝", Enter rejects.
  setCurrent({
    rpcId: "rpc-ap2",
    id: "ap-2",
    title: "权限确认",
    detail: "bash · escalate sandbox to danger-full-access: 写回 D 盘",
    options: ["允许本次", "当前会话允许", "拒绝"],
    kind: "permission",
    approval: { id: "ap-2", toolName: "bash" },
  })
  await app.renderOnce()
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(decided).toEqual(["rejected"])
})

test("plan review modal renders the harness options and answers them", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-plan",
    id: "plan-review",
    title: "Approve this plan and leave plan mode?",
    options: ["Approve", "Keep planning"],
    kind: "plan-approval",
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
  expect(frame).toContain("Plan review")
  expect(frame).toContain("Approve this plan and leave plan mode?")
  expect(frame).toContain("Approve")
  expect(frame).toContain("Keep planning")

  // Enter picks the highlighted "Approve".
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(answered).toEqual(["Approve"])

  // Re-open: Escape falls through to "Keep planning" (the last option).
  setCurrent({
    rpcId: "rpc-plan2",
    id: "plan-review",
    title: "Approve this plan and leave plan mode?",
    options: ["Approve", "Keep planning"],
    kind: "plan-approval",
  })
  await app.renderOnce()
  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()
  expect(answered).toEqual(["Approve", "Keep planning"])
})

test("composer draft survives a plan review question", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>(null)
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

  app.mockInput.typeText("草稿保留测试")
  await new Promise((resolve) => setTimeout(resolve, 80))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("草稿保留测试")

  // A plan review interrupts the composer; the draft must survive it.
  setCurrent({
    rpcId: "rpc-plan",
    id: "plan-review",
    title: "Approve this plan and leave plan mode?",
    options: ["Approve", "Keep planning"],
    kind: "plan-approval",
  })
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Plan review")

  // Press Enter while the review is open: the modal answers; the composer's
  // buffer must be untouched.
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await app.renderOnce()
  expect(answered).toEqual(["Approve"])

  setCurrent(null)
  // The teardown rebuilds the native editor view a frame later, so the draft
  // restore retries shortly after; wait for it to settle.
  await new Promise((resolve) => setTimeout(resolve, 350))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("草稿保留测试")
})

test("escape while busy cancels the running turn instead of going home", async () => {
  let cancelled = 0
  let backed = 0
  const app = await renderSession({
    messages: [userMsg("你好")],
    busy: () => true,
    statusText: "Deep diving",
    onCancel: () => {
      cancelled++
    },
    onBack: () => {
      backed++
    },
  })
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Esc 取消")

  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()
  expect(cancelled).toBe(1)
  expect(backed).toBe(0)
})

test("escape while busy still rejects an open question first", async () => {
  const [current, setCurrent] = createSignal<HarnessQuestion | null>({
    rpcId: "rpc-1",
    id: "q1",
    title: "允许执行 bash 吗？",
    options: ["Yes", "No"],
    kind: "permission",
  })
  let cancelled = 0
  const answered: string[] = []
  const app = await renderSession({
    messages: [userMsg("你好")],
    busy: () => true,
    question: current,
    onCancel: () => {
      cancelled++
    },
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
  expect(cancelled).toBe(0)
})

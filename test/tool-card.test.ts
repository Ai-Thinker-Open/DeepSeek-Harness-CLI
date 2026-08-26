import { expect, test } from "bun:test"
import {
  buildDiffText,
  bashMarkers,
  classifyTool,
  editPair,
  parseCardMeta,
  questionItems,
  todoItems,
  toolBody,
  toolIcon,
  toolSummary,
  toolTitle,
} from "../src/harness/tool-card"

test("classifyTool maps the harness action vocabulary to variants", () => {
  expect(classifyTool("bash")).toBe("bash")
  expect(classifyTool("pwsh")).toBe("bash")
  expect(classifyTool("read")).toBe("read")
  expect(classifyTool("read_image")).toBe("read")
  expect(classifyTool("web_fetch")).toBe("read")
  expect(classifyTool("write")).toBe("write")
  expect(classifyTool("edit")).toBe("edit")
  expect(classifyTool("str_replace_editor")).toBe("edit")
  expect(classifyTool("grep")).toBe("search")
  expect(classifyTool("glob")).toBe("search")
  expect(classifyTool("web_search")).toBe("search")
  expect(classifyTool("run_code")).toBe("code")
  expect(classifyTool("todo_write")).toBe("todo")
  expect(classifyTool("ask_user_question")).toBe("question")
  expect(classifyTool("terminal_open")).toBe("terminal")
  expect(classifyTool("job_output")).toBe("job")
  expect(classifyTool("some_mcp_tool")).toBe("others")
})

test("titles refine variants without replacing the family", () => {
  expect(toolTitle("bash")).toBe("Bash")
  expect(toolTitle("pwsh")).toBe("Shell")
  expect(toolTitle("grep")).toBe("Grep")
  expect(toolTitle("web_search")).toBe("Search")
  expect(toolTitle("read")).toBe("Read")
  expect(toolTitle("mcp_thing")).toBe("Tool call")
})

test("bash summary prefers the description over the command", () => {
  expect(toolSummary("bash", { command: "npm install", description: "Install package dependencies" })).toBe(
    "Install package dependencies",
  )
  expect(toolSummary("bash", { command: "ls" })).toBe("ls")
})

test("file tools summarize by path, search tools by pattern/query", () => {
  expect(toolSummary("edit", { file_path: "src/main.ts", old_string: "a", new_string: "b" })).toBe("src/main.ts")
  expect(toolSummary("read", { file_path: "README.md" })).toBe("README.md")
  expect(toolSummary("grep", { pattern: "TODO", path: "src" })).toBe("TODO")
  expect(toolSummary("web_search", { query: "bun docs" })).toBe("bun docs")
  expect(toolSummary("web_fetch", { url: "https://example.com" })).toBe("https://example.com")
})

test("todo summary counts done and running items", () => {
  const summary = toolSummary("todo_write", {
    todos: [
      { content: "调研", status: "completed" },
      { content: "实现", status: "in_progress" },
      { content: "测试", status: "pending" },
    ],
  })
  expect(summary).toBe("1/3 done · 1 running")
  expect(todoItems({ todos: [{ content: "a", status: "completed" }, { content: "", status: "x" }] })).toEqual([
    { content: "a", status: "completed" },
  ])
})

test("bashMarkers strips exit-code and sandbox footers", () => {
  expect(bashMarkers("hello\n[exit code: 2]")).toEqual({ text: "hello", exitCode: 2 })
  expect(bashMarkers("denied\n[sandbox: file access denied under strict mode]")).toEqual({
    text: "denied",
    sandbox: "file access denied under strict mode",
  })
  expect(bashMarkers("plain output")).toEqual({ text: "plain output" })
})

test("editPair reads both the fs and str_replace_editor arg spellings", () => {
  expect(editPair({ old_string: "a", new_string: "b" })).toEqual({ oldText: "a", newText: "b" })
  expect(editPair({ old_str: "x", new_str: "y" })).toEqual({ oldText: "x", newText: "y" })
  expect(editPair({})).toEqual({})
})

test("buildDiffText renders replacement hunks as a unified diff", () => {
  const built = buildDiffText([{ path: "src/main.ts", oldText: "OLD", newText: "NEW" }])
  expect(built).not.toBeNull()
  expect(built!.diff).toContain("--- a/src/main.ts")
  expect(built!.diff).toContain("+++ b/src/main.ts")
  expect(built!.diff).toContain("@@ -1,1 +1,1 @@")
  expect(built!.diff).toContain("-OLD")
  expect(built!.diff).toContain("+NEW")
  expect(built!.totalLines).toBe(2)
})

test("buildDiffText renders write calls as a new-file diff", () => {
  const built = buildDiffText([{ path: "src/new.ts", newText: "a\nb" }], { newFile: true })
  expect(built!.diff).toContain("--- /dev/null")
  expect(built!.diff).toContain("@@ -0,0 +1,2 @@")
  expect(built!.diff).toContain("+a")
  expect(built!.diff).toContain("+b")
})

test("buildDiffText groups hunks into one patch per file", () => {
  const built = buildDiffText([
    { path: "a.ts", oldText: "OLD", newText: "NEW" },
    { path: "a.ts", newText: "INSERTED" },
  ])
  expect(built).not.toBeNull()
  // The OpenTUI viewer only renders the first patch, so a single file must
  // emit one `---/+++` header followed by both hunks.
  expect(built!.diff.match(/--- a\/a\.ts/g)).toHaveLength(1)
  expect(built!.diff).toContain("@@ -1,1 +1,1 @@")
  expect(built!.diff).toContain("@@ -0,0 +1,1 @@")
  expect(built!.diff).toContain("-OLD")
  expect(built!.diff).toContain("+NEW")
  expect(built!.diff).toContain("+INSERTED")
  expect(built!.totalLines).toBe(3)
})

test("buildDiffText caps content lines and reports the real count", () => {
  const built = buildDiffText([{ path: "a.ts", oldText: "1\n2\n3\n4", newText: "5\n6\n7\n8" }], { maxLines: 3 })
  expect(built!.diff).toContain("-1")
  expect(built!.diff).not.toContain("-4")
  expect(built!.totalLines).toBe(8)
})

test("buildDiffText keeps truncated hunk counts consistent so the diff parses", () => {
  const content = Array.from({ length: 87 }, (_, i) => `line ${i + 1}`).join("\n")
  const built = buildDiffText([{ path: "long.md", newText: content }], { newFile: true, maxLines: 20 })
  const diff = built!.diff.trimEnd().split("\n")
  // The @@ header must promise exactly the emitted lines, not the full file.
  expect(diff[2]).toBe("@@ -0,0 +1,20 @@")
  expect(diff.slice(3).filter((l) => l.startsWith("+")).length).toBe(20)
  expect(diff.some((l) => l.startsWith("+line 21"))).toBe(false)
  // The real count is still reported for the "(N more lines)" note.
  expect(built!.totalLines).toBe(87)
})

test("buildDiffText returns null when hunks carry no content", () => {
  expect(buildDiffText([])).toBeNull()
  expect(buildDiffText([{ path: "a.ts" }])).toBeNull()
  expect(buildDiffText([{ path: "a.ts", oldText: "", newText: "" }])).toBeNull()
})

test("questionItems extracts questions and options", () => {
  expect(
    questionItems({
      questions: [
        { id: "q1", question: "继续？", options: [{ label: "是" }, { label: "否" }] },
        { id: "q2", question: "确认" },
      ],
    }),
  ).toEqual([
    { question: "继续？", options: ["是", "否"] },
    { question: "确认", options: [] },
  ])
})

test("parseCardMeta reads the web card shapes from tool/result meta", () => {
  expect(parseCardMeta({ card: "terminal", output: "hi", exitCode: 2 })).toEqual({
    kind: "terminal",
    terminal: { output: "hi", exitCode: 2 },
  })
  expect(parseCardMeta({ card: "diff", diffs: [{ path: "a.ts", oldText: "old", newText: "new" }] })).toEqual({
    kind: "diff",
    diffs: [{ path: "a.ts", oldText: "old", newText: "new" }],
  })
  expect(parseCardMeta({ card: "read", lines: [{ number: 1, text: "x" }], totalLines: 10 })).toEqual({
    kind: "read",
    lines: [{ number: 1, text: "x" }],
    totalLines: 10,
  })
  expect(
    parseCardMeta({
      card: "search",
      shape: "matches",
      files: [{ path: "a.ts", matches: [{ lineNumber: 3, line: "x" }] }],
    }),
  ).toEqual({ kind: "search", files: [{ path: "a.ts", matches: [{ lineNumber: 3, line: "x" }] }] })
  expect(parseCardMeta({ card: "search", shape: "paths", paths: ["a.ts"] })).toEqual({
    kind: "search",
    paths: ["a.ts"],
  })
  expect(parseCardMeta({ card: "nope" })).toBeNull()
  expect(parseCardMeta(undefined)).toBeNull()
})

test("parseCardMeta reads the real wire metas without a card discriminator", () => {
  expect(parseCardMeta({ diffs: [{ path: "a.ts", oldText: "old", newText: "new" }] })).toEqual({
    kind: "diff",
    diffs: [{ path: "a.ts", oldText: "old", newText: "new" }],
  })
  // `oldText: null` on the wire means a pure insertion → folded to undefined.
  expect(parseCardMeta({ diffs: [{ path: "a.ts", oldText: null, newText: "new" }] })).toEqual({
    kind: "diff",
    diffs: [{ path: "a.ts", oldText: undefined, newText: "new" }],
  })
  expect(parseCardMeta({ path: "/x/a.ts", offset: 1, lines: [{ number: 1, text: "x" }], totalLines: 10 })).toEqual({
    kind: "read",
    lines: [{ number: 1, text: "x" }],
    totalLines: 10,
  })
  expect(
    parseCardMeta({ shape: "matches", files: [{ path: "a.ts", matches: [{ lineNumber: 3, line: "x" }] }], total: 1 }),
  ).toEqual({ kind: "search", files: [{ path: "a.ts", matches: [{ lineNumber: 3, line: "x" }] }], total: 1 })
  expect(parseCardMeta({ shape: "paths", paths: ["a.ts"], total: 1 })).toEqual({
    kind: "search",
    paths: ["a.ts"],
    total: 1,
  })
})

test("web_search keeps its own globe-ish icon while local search stays a magnifier", () => {
  expect(toolIcon("web_search")).toBe("❍")
  expect(toolIcon("grep")).toBe("⌕")
  expect(toolIcon("glob")).toBe("⌕")
  expect(toolIcon("bash")).toBe("❯")
  expect(toolIcon("read")).toBe("▤")
  expect(toolIcon("edit")).toBe("✎")
  expect(toolIcon("todo_write")).toBe("☑")
  expect(toolIcon("unknown_tool")).toBe("✦")
})

test("generic action families get meaningful summaries", () => {
  expect(toolSummary("subagent", { description: "调研 bug", prompt: "看一下日志" })).toBe("调研 bug")
  expect(toolSummary("workflow", { meta: { name: "全库审计", description: "审计所有文件" } })).toBe("全库审计")
  expect(toolSummary("lsp", { operation: "definition", file_path: "src/a.ts", line: 3, character: 5 })).toBe(
    "definition · src/a.ts:3:5",
  )
  expect(toolSummary("update_goal", { goal_id: "g1", revision: 2, action: "complete" })).toBe("complete · g1")
  expect(toolSummary("schedule_create", { prompt: "跑测试", after_seconds: 60 })).toBe("跑测试 · in 60s")
  expect(toolSummary("interrupt_agent", { agent_id: "a1" })).toBe("✕ a1")
  expect(toolSummary("send_message", { subagent_id: "a1", message: "继续" })).toBe("→ a1")
  expect(toolSummary("create_goal", { objective: "发布 v2" })).toBe("发布 v2")
  expect(toolSummary("skill", { name: "opentui" })).toBe("opentui")
  expect(toolSummary("exit_plan_mode", { plan: "先重构再测试" })).toBe("先重构再测试")
  expect(toolSummary("job_output", { job_id: "j1" })).toBe("j1")
  expect(toolSummary("cordis_define", { name: "my-plugin", purpose: "演示" })).toBe("my-plugin")
})

test("generic action families get readable expanded bodies", () => {
  expect(toolBody("subagent", { description: "调研", prompt: "看下日志" })).toBe("调研\nprompt: 看下日志")
  expect(toolBody("report", { output: "已完成\n详情如下" })).toBe("已完成\n详情如下")
  expect(toolBody("lsp", { operation: "definition", file_path: "src/a.ts", line: 3, character: 5 })).toBe(
    "definition\nsrc/a.ts:3:5",
  )
  expect(toolBody("schedule_create", { prompt: "跑测试", every_seconds: 3600 })).toBe("跑测试\nevery: 3600s")
  expect(
    toolBody("workflow", { meta: { name: "审计", description: "全库", phases: [{ title: "a" }] }, script: "return 1" }),
  ).toBe("审计\n全库\nphases: 1\nscript: return 1")
  expect(toolBody("cordis_run", { pluginId: "p1", packageId: "pkg1", mode: "prod" })).toBe(
    "plugin: p1\npackage: pkg1\nmode: prod",
  )
  expect(toolBody("update_goal", { goal_id: "g1", revision: 2, action: "complete" })).toBe(
    "goal: g1\nrevision: 2\naction: complete",
  )
  expect(toolBody("job_kill", { job_id: "j1", reason: "超时" })).toBe("job: j1\nreason: 超时")
  // Unknown tools still fall back to the pretty-printed args.
  expect(toolBody("mystery_tool", { foo: "bar" })).toBe('{\n  "foo": "bar"\n}')
})

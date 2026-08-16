import { expect, test } from "bun:test"
import {
  bashMarkers,
  classifyTool,
  editPair,
  questionItems,
  todoItems,
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
  expect(toolTitle("pwsh")).toBe("Pwsh")
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

import { expect, test } from "bun:test"
import { HARNESS_COMMANDS, LOCAL_COMMANDS, bareCommandName, filterCommands, mergeCommands } from "../src/commands"

test("hardcoded harness commands always ship in the catalog", () => {
  const names = HARNESS_COMMANDS.map((c) => c.name)
  expect(names).toEqual(expect.arrayContaining(["compact", "feedback", "goal", "plan", "export"]))
  expect(HARNESS_COMMANDS.find((c) => c.name === "feedback")?.input?.hint).toBe("<text>")
  expect(HARNESS_COMMANDS.find((c) => c.name === "goal")?.input?.hint).toContain("edit")
  expect(HARNESS_COMMANDS.find((c) => c.name === "plan")?.input?.hint).toBe("<任务描述|off>")
  expect(LOCAL_COMMANDS.map((c) => c.name)).toEqual(["sessions", "resume", "help"])
})

test("mergeCommands dedupes by name and hardcoded entries win", () => {
  const merged = mergeCommands(
    LOCAL_COMMANDS,
    [
      { name: "goal", description: "stale dynamic description", kind: "host" },
      { name: "plan", description: "plan mode", kind: "host" },
    ],
    HARNESS_COMMANDS,
  )
  const goal = merged.find((c) => c.name === "goal")
  expect(goal?.description).toContain("long-running task")
  expect(merged.map((c) => c.name)).toContain("plan")
  expect(merged.filter((c) => c.name === "goal")).toHaveLength(1)
})

test("bareCommandName only accepts a bare command name", () => {
  expect(bareCommandName("/sessions")).toBe("sessions")
  expect(bareCommandName("/feedback ")).toBeUndefined()
  expect(bareCommandName("/feedback text")).toBeUndefined()
  expect(bareCommandName("hello")).toBeUndefined()
  expect(bareCommandName("/goal")).toBe("goal")
})

test("filterCommands ranks prefix matches before substring matches", () => {
  const items = [
    { name: "goal", description: "", kind: "host" as const },
    { name: "glob", description: "", kind: "host" as const },
    { name: "help", description: "", kind: "local" as const },
  ]
  expect(filterCommands(items, "go").map((i) => i.name)).toEqual(["goal"])
  expect(filterCommands(items, "o").map((i) => i.name)).toEqual(["goal", "glob"])
})

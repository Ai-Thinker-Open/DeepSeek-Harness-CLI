import { expect, test } from "bun:test"
import { HarnessClient } from "../src/harness/client"

test("command RPCs hit the commands namespace with session-scoped payloads", async () => {
  const seen: Array<{ method: string; payload: unknown }> = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (method: string, payload: unknown) => {
    seen.push({ method, payload })
    if (method === "commands.list") return []
    if (method === "commands.execute") return undefined
    throw new Error(`unexpected ${method}`)
  }) as typeof client.call

  await client.commandList("s-1")
  await client.commandExecute("s-1", "/compact")
  expect(seen).toEqual([
    { method: "commands.list", payload: { sessionId: "s-1" } },
    { method: "commands.execute", payload: { sessionId: "s-1", line: "/compact" } },
  ])
})

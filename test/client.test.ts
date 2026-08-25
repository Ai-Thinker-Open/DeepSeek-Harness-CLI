import { expect, test } from "bun:test"
import { HarnessClient, HarnessError } from "../src/harness/client"

test("command RPCs hit the Typert remote gateway with agentId args", async () => {
  const seen: Array<{ method: string; payload: unknown }> = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (method: string, payload: unknown) => {
    seen.push({ method, payload })
    if (method === "commands/list") return []
    if (method === "commands/execute") return undefined
    throw new Error(`unexpected ${method}`)
  }) as typeof client.call

  await client.commandList("s-1")
  await client.commandExecute("s-1", "/compact")
  expect(seen).toEqual([
    { method: "commands/list", payload: { args: { agentId: "s-1" } } },
    { method: "commands/execute", payload: { args: { agentId: "s-1", line: "/compact", images: [] } } },
  ])
})

test("command RPCs fall back to the dot namespace when the Typert gateway is missing", async () => {
  const seen: string[] = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (method: string) => {
    seen.push(method)
    if (method === "commands/list" || method === "commands/execute") {
      throw new HarnessError("endpoint not found", "not-found")
    }
    return method === "commands.list" ? [] : undefined
  }) as typeof client.call

  await client.commandList("s-1")
  await client.commandExecute("s-1", "/plan")
  expect(seen).toEqual(["commands/list", "commands.list", "commands/execute", "commands.execute"])
})

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
    { method: "commands/list", payload: { agentId: "s-1" } },
    { method: "commands/execute", payload: { agentId: "s-1", line: "/compact", images: [] } },
  ])
})

test("command RPCs do not retry the removed dot-notation endpoint", async () => {
  const seen: string[] = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (method: string) => {
    seen.push(method)
    throw new HarnessError("endpoint not found", "not-found")
  }) as typeof client.call

  await expect(client.commandList("s-1")).rejects.toThrow()
  await expect(client.commandExecute("s-1", "/plan")).rejects.toThrow()
  expect(seen).toEqual(["commands/list", "commands/execute"])
})

test("unary RPC payload is wrapped under the gateway args envelope", async () => {
  const client = new HarnessClient("http://127.0.0.1:3080")
  const sent: Array<{ method: string; payload: unknown }> = []
  const stub = client as unknown as { post: (path: string, body: unknown) => Promise<unknown> }
  stub.post = (async (path: string, body: unknown) => {
    const b = body as { type: string; method: string; payload: { args: unknown } }
    sent.push({ method: `${path} ${b.method}`, payload: b.payload })
    return { result: { ok: true, value: { accepted: true } } }
  }) as unknown as typeof stub.post

  await client.call("session/prompt", { sessionId: "s-1", mode: "queue", content: [], clientTimeZone: "UTC" })
  await client.call("session/list", {})
  await client.call("session/modelCatalog", {})
  await client.call("credentials.set", { ref: "API_KEY", value: "secret" })

  expect(sent).toEqual([
    { method: "/api/session/prompt session/prompt", payload: { args: { request: { sessionId: "s-1", mode: "queue", content: [], clientTimeZone: "UTC" } } } },
    { method: "/api/session/list session/list", payload: { args: { _request: {} } } },
    { method: "/api/session/modelCatalog session/modelCatalog", payload: { args: {} } },
    { method: "/api/credentials/set credentials/set", payload: { args: { ref: "API_KEY", value: "secret" } } },
  ])
})

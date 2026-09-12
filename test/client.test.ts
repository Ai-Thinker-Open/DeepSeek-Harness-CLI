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
    { method: "commands/execute", payload: { agentId: "s-1", line: "/compact", submittedAttachments: [] } },
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

test("catalog model ids resolve to their display names for the badge", async () => {
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (method: string) => {
    if (method === "session/modelCatalog") {
      return {
        default: { provider: "deepseek-official", model: "deepseek-flash" },
        routableProviders: ["deepseek-official"],
        groups: [
          {
            id: "deepseek-official",
            name: "DeepSeek",
            models: [
              // dsh's v4.1 flash model: the id gives no hint of the version.
              { id: "deepseek-flash", name: "DeepSeek-V41-Flash" },
              { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
            ],
          },
        ],
        failures: [],
      }
    }
    if (method === "session/canOpenWorkspacePath") return true
    throw new Error(`unexpected ${method}`)
  }) as typeof client.call

  // Before any catalog read there is no mapping to apply.
  expect(client.modelLabel("deepseek-flash")).toBe("deepseek-flash")

  const info = await client.describe()
  expect(info.model).toBe("DeepSeek-V41-Flash")

  // The mapping is retained for ids that arrive later (request/context,
  // selectModel), and unknown ids fall back to themselves.
  expect(client.modelLabel("deepseek-flash")).toBe("DeepSeek-V41-Flash")
  expect(client.modelLabel("deepseek-v4-flash")).toBe("DeepSeek-V4-Flash")
  expect(client.modelLabel("mystery-model")).toBe("mystery-model")
})

/** The gateway's rejection for a harness whose descriptor still says `images`. */
function fieldMismatch(field: string): HarnessError {
  return new HarnessError(
    `args fields do not match the descriptor: missing "images"; unexpected "${field}"`,
    "gateway/arguments-invalid",
  )
}

test("commandExecute negotiates the renamed attachment field once, then remembers it", async () => {
  const fields: string[] = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (_method: string, payload: Record<string, unknown>) => {
    const field = "images" in payload ? "images" : "submittedAttachments"
    fields.push(field)
    // A harness on dsh-commands <= 0.1.5-rc.1 rejects the current name.
    if (field === "submittedAttachments") throw fieldMismatch(field)
    return { commandId: "c1", result: { kind: "success", text: "ok" } }
  }) as unknown as typeof client.call

  await client.commandExecute("s-1", "/plan")
  await client.commandExecute("s-1", "/model")

  // First call: probe the current name, fall back to `images`. Second call:
  // straight to the remembered name, with no further probe.
  expect(fields).toEqual(["submittedAttachments", "images", "images"])
})

test("commandExecute does not retry an attachment-unrelated arguments-invalid", async () => {
  const fields: string[] = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (_method: string, payload: Record<string, unknown>) => {
    fields.push("images" in payload ? "images" : "submittedAttachments")
    throw new HarnessError(
      'args fields do not match the descriptor: missing "line"',
      "gateway/arguments-invalid",
    )
  }) as unknown as typeof client.call

  await expect(client.commandExecute("s-1", "/plan")).rejects.toThrow(/missing "line"/)
  expect(fields).toEqual(["submittedAttachments"])
})

test("commandExecute reverts the field when neither name is accepted", async () => {
  const fields: string[] = []
  const client = new HarnessClient("http://127.0.0.1:3080")
  client.call = (async (_method: string, payload: Record<string, unknown>) => {
    const field = "images" in payload ? "images" : "submittedAttachments"
    fields.push(field)
    throw fieldMismatch(field)
  }) as unknown as typeof client.call

  await expect(client.commandExecute("s-1", "/plan")).rejects.toThrow()
  expect(fields).toEqual(["submittedAttachments", "images"])

  // The cache reverted, so the next call starts from the default again rather
  // than latching the failed guess.
  await expect(client.commandExecute("s-1", "/plan")).rejects.toThrow()
  expect(fields).toEqual(["submittedAttachments", "images", "submittedAttachments", "images"])
})

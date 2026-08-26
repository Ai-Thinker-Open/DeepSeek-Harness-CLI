import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { configuredMcpServers, listMcpTools, listServerTools, parseMcpServers, refreshMcpStatus } from "../src/mcp"

const PATCH = `# Auto-added by dsh-cli bootstrap: FlashKey MCP (SSE).
- insert:
    - id: mcp-flashkey
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: flashkey
        url: http://127.0.0.1:8100/sse
- insert:
    - id: mcp-custom
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: custom
        command: some-cli
        args:
          - --stdio
`

test("parseMcpServers extracts SSE and stdio rows from the profile patch", () => {
  const servers = parseMcpServers(PATCH)
  expect(servers).toEqual([
    { serverName: "flashkey", url: "http://127.0.0.1:8100/sse" },
    { serverName: "custom", command: "some-cli", args: ["--stdio"] },
  ])
})

let homeDir: string | undefined
let server: ReturnType<typeof Bun.serve> | undefined
let mockUnavailable = false

beforeAll(() => {
  homeDir = mkdtempSync(join(tmpdir(), "dsh-mcp-test-"))
  try {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/sse" && req.method === "GET") {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /messages?sessionId=mock\n\n"))
            },
          })
          return new Response(stream, { headers: { "content-type": "text/event-stream" } })
        }
        if (url.pathname.startsWith("/messages") && req.method === "POST") {
          return req.text().then((body) => {
            const reqJson = JSON.parse(body) as { method?: string; id?: number }
            // JSON-RPC notifications get an empty 202 body, matching the real
            // MCP SSE servers the client talks to.
            if (reqJson.id === undefined) return new Response("", { status: 202 })
            const result =
              reqJson.method === "initialize"
                ? { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "mock", version: "1" } }
                : reqJson.method === "tools/list"
                  ? { tools: [{ name: "status", description: "设备状态" }, { name: "flash" }] }
                  : {}
            const payload = { jsonrpc: "2.0", ...(reqJson.id === undefined ? {} : { id: reqJson.id }), result }
            const body2 = `event: message\ndata: ${JSON.stringify(payload)}\n\n`
            return new Response(body2, { headers: { "content-type": "text/event-stream" } })
          })
        }
        return new Response("not found", { status: 404 })
      },
    })
  } catch {
    // Restricted sandboxes (no loopback binding) skip the network assertions;
    // the parser tests above still run everywhere.
    mockUnavailable = true
  }
  const profile = join(homeDir, "profiles", "tui")
  mkdirSync(profile, { recursive: true })
  const sseUrl = mockUnavailable ? "http://127.0.0.1:8100/sse" : `http://127.0.0.1:${server!.port}/sse`
  writeFileSync(join(profile, "cordis.patch.yml"), PATCH.replace("http://127.0.0.1:8100/sse", sseUrl))
  process.env.DSH_HOME = homeDir
})

afterAll(() => {
  server?.stop(true)
  server = undefined
  if (homeDir) rmSync(homeDir, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

test("configuredMcpServers reads the tui profile patch", () => {
  const servers = configuredMcpServers()
  expect(servers.map((s) => s.serverName)).toEqual(["flashkey", "custom"])
})

test("refreshMcpStatus probes SSE servers and marks stdio rows disabled", async () => {
  if (mockUnavailable) return
  const statuses = await refreshMcpStatus()
  expect(statuses).toEqual([
    { name: "flashkey", status: "connected", url: `http://127.0.0.1:${server!.port}/sse` },
    { name: "custom", status: "disabled" },
  ])
})

test("listServerTools performs the MCP SSE handshake and returns tools", async () => {
  if (mockUnavailable) return
  const tools = await listServerTools({ serverName: "flashkey", url: `http://127.0.0.1:${server!.port}/sse` })
  expect(tools).toEqual([
    { server: "flashkey", name: "status", description: "设备状态" },
    { server: "flashkey", name: "flash" },
  ])
})

test("listMcpTools aggregates every configured server (stdio servers yield none)", async () => {
  if (mockUnavailable) return
  const tools = await listMcpTools()
  expect(tools.map((t) => `${t.server}:${t.name}`)).toEqual(["flashkey:status", "flashkey:flash"])
})

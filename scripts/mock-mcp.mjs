/**
 * Mock MCP stdio server for testing dsh-cli's MCP client.
 * Speaks JSON-RPC 2.0 over stdio: initialize, notifications/initialized,
 * tools/list, tools/call.
 */
import readline from 'node:readline'

const tools = [
  {
    name: 'echo',
    description: 'Echo the message back',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'poke',
    description: 'Write a file (mutating, tests permission gating)',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
]

const rl = readline.createInterface({ input: process.stdin })
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock-mcp', version: '1.0.0' } } })
  } else if (msg.method === 'notifications/initialized') {
    // no response
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } })
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params
    if (name === 'echo') {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo: ${args.message}` }] } })
    } else if (name === 'poke') {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `wrote ${args.path}` }] } })
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true } })
    }
  }
})

process.stdin.on('end', () => process.exit(0))

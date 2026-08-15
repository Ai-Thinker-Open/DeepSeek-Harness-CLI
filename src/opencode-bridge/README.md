# OpenCode TUI bridge for DeepSeek Harness

This directory is the compatibility contract and future home of the bridge
that lets the OpenCode/MiMo TUI render a live DeepSeek Harness (`dsh`) session.

## Goal

Reuse the OpenCode/MiMo terminal UI as the front end, while keeping the actual
agent runtime, tools, permissions, sessions, plan mode, goals, and command
plane inside DeepSeek Harness. The bridge must not fork DSH's behavior; it only
translates protocols.

## Why a bridge instead of a port

The current `dsh-cli` TUI is Ink/React. OpenCode/MiMo's TUI is
`@opentui/solid`. They do not share a component or renderer layer. A bridge
keeps the proven OpenCode UI intact and makes DSH look like its server.

The existing [HarnessClient](../../harness/client.ts) and
[HarnessDriver](../../harness/driver.ts) already cover the DSH side. The
bridge needs to add the OpenCode-facing half.

## Compatibility boundary

### DSH command plane

DSH slash commands are **human commands**, not ordinary prompts. They are
executed by the host command registry and are kept out of model history.
The bridge must map them to `command.execute`-equivalent behavior.

The base command contract lives in [`dsh-commands.ts`](./dsh-commands.ts):

| Command | Behavior |
|---|---|
| `/plan` | enter plan mode |
| `/plan off` | leave plan mode |
| `/plan <message>` | enter plan mode, then steer the message to the agent |
| `/goal` | show current goal/state |
| `/goal <objective>` | create/arm a goal |
| `/goal edit <objective>` | edit the current objective |
| `/goal pause` | pause/disarm continuation |
| `/goal resume` | resume/rearm continuation |
| `/goal clear` | clear the current goal pointer |
| `/compact` | compact older context; no arguments accepted |
| `/permission` | report current permission preset |
| `/permission workspace-write` | switch to workspace-write preset |
| `/permission danger-full-access` | switch to full-access preset |

The exact grammar and validation in `dsh-commands.ts` mirrors DSH's
`parseCommand` and command handlers. Unknown slash commands are rejected
instead of being sent as model prompts.

### DSH RPC surface already understood by `HarnessClient`

- `host.describe`
- `session.list`
- `session.create`
- `session.history`
- `session.prompt`
- `session.cancel`
- `session.rename`
- `session.fork`
- `session.models`
- `session.selectModel`
- `question/requested` / `respond`
- `session/projection`
- `events.mux` stream

### OpenCode TUI server surface the bridge must expose

The OpenCode SDK expects a local HTTP server and an SSE event stream. The
first milestone needs at least:

- `GET /global/health`
- `GET /global/event`
- `GET /session`
- `POST /session`
- `GET /session/:sessionID`
- `GET /session/:sessionID/message`
- `POST /session/:sessionID/message` or `prompt_async`
- `POST /session/:sessionID/abort`
- `GET /session/:sessionID/todo`
- `GET /command`
- `POST /session/:sessionID/command`

DSH events then need to be projected into OpenCode global events:

| DSH source | OpenCode event |
|---|---|
| `session/event` (`user/message`, `assistant/message`) | `message.updated` |
| assistant text/reasoning chunks | `message.part.updated` / `message.part.delta` |
| `tool/call`, `tool/result` | `message.part.updated` (`tool` part) |
| `question/requested` | `question.asked` / `permission.asked` |
| `session/projection` (`todos`) | `todo.updated` |
| `session/projection` (`plan`) | session/command state update |
| `host/session-status` | `session.status` / `session.idle` |

## Suggested milestones

1. **Command contract and type adapter**: land the exact DSH command table and
   shared bridge types. (Started here.)
2. **Read-only bridge**: session list/get, history replay, message stream, and
   event projection. No mutations except prompt.
3. **Interactive bridge**: prompt, abort, command execution, questions,
   permissions, plan projection, todos, model selection.
4. **OpenCode TUI launch flow**: a `dsh-cli-bridge` command starts DSH-facing
   bridge, then launches/attaches OpenCode/MiMo TUI.
5. **Parity test**: compare bridge behavior against the official `dsh web` UI
   on the same DSH instance.

## License note

OpenCode/MiMo TUI source is reused as a dependency or fork with its original
license and attribution preserved. No source is copied into `dsh-cli`'s own
runtime path. The bridge code here is original.

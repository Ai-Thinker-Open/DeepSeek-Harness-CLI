# DeepSeek Harness CLI (`dsh-cli`)

A terminal client for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness), built with [OpenTUI](https://github.com/opentui/opentui) + SolidJS.

It drives a locally running DeepSeek Harness instance: sessions, tool calls, permission approvals, plan mode and history all live in the harness, while this client renders them as a fluid terminal interface (with a MiMo-style launch screen and animated tool cards). **No local API key required.**

```
   dsh-cli                    # probe and connect to a local harness
   dsh-cli -c                 # resume the most recent session directly
   dsh --profile tui          # run as a harness component (TUI mode)
```

## Features

- **Session management**: create / resume / rename / fork sessions, fast `-c` resume of the last session
- **Streaming render**: body, reasoning (Think blocks) and tool calls stream in at 30fps without jank
- **Tool cards**: Bash / Read / Edit / Write / Search / Code / Todo / Question row variants with summaries, expandable bodies, a diff viewer and a running shine animation; glyphs align with the DSH web client icons
- **Permission approvals**: permission / ask-user / plan-review questions render as a modal — ↑↓ to select, Enter to confirm, Esc to reject
- **Plan mode**: `/plan` toggles plan mode; the badge reflects `active/pending` state live
- **Slash commands**: local commands, harness host commands and skills all live in the `/` menu
- **Queue dock**: pending / steering messages can be edited, removed or sent inline
- **Stats bar**: turns, steps, LLM/tool time, average first-token latency, cache-hit ratio and token usage
- **Resilient connection**: auto-reconnect, a streaming stall watchdog and recovery from durable history

## Requirements

- [Bun](https://bun.sh) (both build and runtime depend on it; `dist/cli.js` runs under Bun)
- An optional local DeepSeek Harness instance (`dsh-cli` probes for one and boots it if missing)

## Quick start

```sh
bun install
bun run build        # produces dist/cli.js, dist/startup.js, dist/runner.js, dist/dispatcher.js
bun link             # optional: expose bin/dsh-cli globally
```

Then just run:

```sh
dsh-cli              # probes http://127.0.0.1:3080 for a running harness;
                     # otherwise installs the tui profile and boots dsh --profile tui
dsh-cli -c           # resume the most recent session and jump straight in
```

`bin/dsh-cli` is a thin shell: it auto-builds `dist/` when missing, then forwards its arguments to `dist/dispatcher.js`.

### Run as a DeepSeek Harness component

This package is also a Cordis plugin (mounted via the `dsh.bundle.patch` field in `package.json`, pointing at `cordis.patch.yml`), so it can be started like any other harness surface:

```sh
dsh --profile tui                        # boot harness + terminal client in TUI mode
dsh --profile tui --port 0               # let the OS pick a free port
dsh --profile tui --cwd ~/my-project     # set the session workspace
dsh --profile tui -c                     # resume the last session
```

Once started, the `tui-runner` plugin reads the bound web-server address, spawns the terminal client with `DSH_URL` / `DSH_CWD`, and shuts down the whole dsh process when the client exits.

### CLI options (`dsh --profile tui`)

| Option | Description |
|---|---|
| `--host <host>` | Bind address; loopback `127.0.0.1` only (default) |
| `--port <port>` | Listen port; `0` lets the OS pick one (default `3080`) |
| `--cwd <dir>` | Working directory for new sessions (default: invoking directory) |
| `-c, --continue` | Resume the most recent session on startup |
| `-h, --help` | Show help |

> `dsh-cli -c` forwards `--continue` to the client as well.

### Environment variables

| Variable | Description |
|---|---|
| `DSH_URL` | Harness address (default `http://127.0.0.1:3080`) |
| `DSH_CWD` | Session working directory (default: current directory) |
| `DSH_DEBUG` | Set to `1` for protocol / debug logging |
| `DSH_HOME` | Harness data directory (default `~/.dsh`) |
| `DSH_NPX_CACHE` | npx cache directory used to speed up `dsh` resolution (default `~/.npm/_npx`) |
| `DSH_TOOLS_MODE` | Process-wide Code Mode opt-in (forwarded to the tools row) |

## Usage

| Action | Description |
|---|---|
| `Tab` / `Shift+Tab` | Cycle permission presets: `read-only` → `workspace-write` → `full-access` |
| `/` | Open the command menu (local / host / skills, prefix-filtered) |
| `Esc` | Close the menu / go back to home / reject the current question |
| `Enter` | Send message / confirm selection |
| `↑↓` | Move through menus and options |
| Mouse | Click to expand tool cards and queue rows; drag to select text (OSC52 copy) |
| `Ctrl+C` | Quit |

### Slash commands

- **Local**: `/sessions`, `/resume`, `/model`, `/rename`, `/fork`, `/help`
- **Host** (executed by the harness): `/compact`, `/feedback`, `/goal`, `/plan`, `/permission`, `/export`
- **Skills**: the session's skill catalog merges into the `/` menu and is sent as an ordinary user message
- **MCP-style**: `/server:tool` lines go through the message channel

## Development

```sh
bun run dev           # run src/cli.tsx directly (needs a harness or the mock)
bun run dev:debug     # same with DSH_DEBUG=1
bun run typecheck     # tsc --noEmit
bun test              # full suite (protocol / event folding / rendered frames / interactions)
```

No real harness handy? Use the built-in mock server to develop the TUI:

```sh
bun scripts/mock-dsh-server.mjs           # listens on 127.0.0.1:3080
PORT=3456 bun scripts/mock-dsh-server.mjs # different port
MOCK_SLOW=1 bun scripts/mock-dsh-server.mjs  # slower streaming to watch animations

DSH_URL=http://127.0.0.1:3080 bun run dev
```

The mock speaks the DSH protocol (`/api/<method>` unary RPC, `events.mux` WebSocket downlink, `/api/respond`). Prompts containing "ask …" trigger a permission question; anything else replays a scripted turn with a tool call (bash / read / grep / edit) so the tool-card shine animation is visible across tool kinds.

## Architecture

```
bin/dsh-cli                   thin entry shell (auto-builds dist/)
  └─ src/dsh/dispatcher.ts    probe for a running harness → run the TUI directly;
                              otherwise boot dsh --profile tui
inside the dsh process (cordis.patch.yml)
  └─ src/dsh/startup.ts       parses --host/--port/--cwd/-c, provides the tuiStartup service
  └─ src/dsh/runner.ts        reads the bound web-server address, spawns dist/cli.js,
                              shuts dsh down when the client exits
TUI process
  └─ src/cli.tsx              OpenTUI renderer setup
  └─ src/app.tsx              app shell: screen switching / permission mode / toast / command routing
  └─ src/screens/*            the home and session screens
  └─ src/harness/session.ts   session driver: event folding / mux loop / reconnect / stats
  └─ src/harness/client.ts    DSH /api HTTP + events.mux WebSocket transport
  └─ src/harness/fold.ts      event → ChatMessage pure helpers
  └─ src/harness/tool-card.ts tool-row classification / summaries / card models / diffs
  └─ src/components/*         16 UI components (prompt / message-view / markdown / logo …)
```

### Key design decisions

- **Dual identity**: the same package works as a standalone CLI and as a Cordis plugin running inside the official `dsh` process
- **Render only what changed**: Solid `<For>` memoizes by object identity, and a dirty-flag pass flushes mutations in 32ms batches, so streaming chunk bursts never stall the loop
- **Delayed tool settlement**: millisecond tools (reads, greps) hold their running state for ~600ms so the shine animation stays visible
- **Self-healing connection**: a 20s no-frame watchdog forces a reconnect and rebuilds the conversation from durable history
- **Keyboard compatibility**: legacy escape sequences, DECCKM and kitty CSI-u codes are all handled

## Project layout

```
bin/              CLI entry shell
cordis.patch.yml  dsh plugin patch (profile row config)
scripts/          build.ts build script, mock-dsh-server.mjs dev mock
src/
  cli.tsx         OpenTUI entry
  app.tsx         app shell
  screens/        home / session screens
  harness/        session driver, transport, event folding, tool-row models
  components/     UI components
  dsh/            Cordis plugins (startup / runner / dispatcher / types)
test/             Bun tests (protocol, folding, rendered frames, interactions)
```

## License

MIT

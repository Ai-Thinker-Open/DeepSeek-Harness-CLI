![DeepSeek Harness CLI](assets/deepseek-harness-cli.png)

A terminal client for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness), built with [OpenTUI](https://github.com/opentui/opentui) 0.5.x + SolidJS.

It drives a locally running DeepSeek Harness instance: sessions, tool calls, permission approvals, plan mode and history all live in the harness, while this client renders them as a fluid terminal interface — MiMo-style launch screen, animated tool cards, and real SVG icons where the terminal supports Kitty/Sixel graphics. **No local API key required.**

```
   dsh-cli                    # probe and connect to a local harness
   dsh-cli -c                 # resume the most recent session directly
   dsh --profile tui          # run as a harness component (TUI mode)
```

## Features

- **Session management**: create / resume / rename / fork sessions, fast `-c` resume of the last session
- **Streaming render**: body, reasoning (Think blocks) and tool calls stream in at 30fps without jank
- **Tool cards**: Bash / Read / Edit / Write / Search / Code / Todo / Question / Terminal / Job row variants with summaries, expandable bodies, a diff viewer and a running shine animation; leading icons are the official DSH web-client SVGs baked to PNG and rendered via Kitty / Sixel graphics, with a Unicode glyph fallback
- **Think blocks**: reasoning streams in a collapsible block that shares the tool rows' shine animation and hover collapse hint
- **Permission approvals**: permission / ask-user / plan-review questions render as a modal — ↑↓ to select, Enter to confirm, Esc to reject
- **Plan mode**: `/plan` enters / exits plan mode; the badge reflects `active/pending` state live
- **Slash commands**: local commands, harness host commands and skills all live in the `/` menu
- **Queue dock**: pending / steering messages can be edited, removed or sent inline
- **Stats bar**: turns, steps, LLM/tool time, average first-token latency, cache-hit ratio and token usage
- **Resilient connection**: auto-reconnect, a streaming stall watchdog and recovery from durable history

## Requirements

- [Bun](https://bun.sh) (both build and runtime depend on it; `dist/cli.js` runs under Bun)
- An optional local DeepSeek Harness instance (`dsh-cli` probes for one and boots it if missing)

## Installation

1. **Install Bun** — required to build and run the client:

   ```sh
   curl -fsSL https://bun.sh/install | bash   # or use your package manager
   ```

2. **Install the DeepSeek Harness CLI (optional)** — `dsh-cli` can boot the harness automatically through npx, but a global install makes startup faster:

   ```sh
   npm install -g @deepseek-ai/dsh
   ```

3. **Install `dsh-cli`**:

   From npm (after publishing):

   ```sh
   npm install -g @ai-thinker/deepseek-harness-cli   # provides the `dsh-cli` command
   npx @ai-thinker/deepseek-harness-cli              # or run it directly without installing
   ```

   Or from source:

   ```sh
   git clone git@github.com:Ai-Thinker-Open/DeepSeek-Harness-CLI.git
   cd DeepSeek-Harness-CLI
   bun install
   bun run build
   bun link          # exposes the global `dsh-cli` command
   ```

Then run `dsh-cli` (or `dsh-cli -c`). The first launch auto-builds `dist/` if it is missing and boots a harness when none is running. Note: the terminal client itself is executed by Bun, so Bun must be installed even for the npm/npx install.

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
| `OPENTUI_IMAGE_PROTOCOL` | Icon rendering protocol override: `auto` / `kitty` / `sixel` / `blocks` |
| `OPENTUI_GRAPHICS` | Set to `false` to disable Kitty/Sixel detection (icons fall back to glyphs) |

## Usage

| Action | Description |
|---|---|
| `Tab` / `Shift+Tab` | Cycle permission presets: `read-only` → `workspace-write` → `full-access` |
| `/` | Open the command menu (local / host / skills, prefix-filtered) |
| `Esc` | Close the menu / go back to home / reject the current question |
| `Enter` | Send message / confirm selection |
| `↑↓` | Move through menus and options |
| Mouse | Click to expand tool cards and queue rows; hover tool rows to reveal the collapse hint; drag to select text (OSC52 copy) |
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
bun run icons         # re-render SVG icons to PNGs + regenerate src/assets-icons.ts
bun run build         # bundle dist/ (pins solid-js to the client runtime)
bun run typecheck     # tsc --noEmit
bun test              # full suite (protocol / event folding / rendered frames / interactions)
```

### Icons

Tool and Think icons start as SVGs in `assets/icons-src/` — extracted from the official DSH web-client icon set (`packages/client/ui-primitives/src/icons` in deepseek-ai/DeepSeek-Harness), plus a TUI-only `terminal` variant (`job` uses the official gear icon). `bun run icons` renders each one to a 64×64 PNG in `assets/icons/` and regenerates `src/assets-icons.ts` as base64 data URLs, so the bundle needs no runtime asset paths. On screen, `ToolIcon` renders the PNG (2 cells wide) when the terminal supports Kitty or Sixel graphics and falls back to the Unicode glyph otherwise; tmux and plain SSH sessions get glyphs automatically.

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
  └─ src/components/*         16 UI components (prompt / message-view / markdown / logo / tool-icon …)
  └─ src/assets-icons.ts      generated PNG data-URL module (see scripts/icons.mjs)
```

### Key design decisions

- **Dual identity**: the same package works as a standalone CLI and as a Cordis plugin running inside the official `dsh` process
- **Render only what changed**: Solid `<For>` memoizes by object identity, and a dirty-flag pass flushes mutations in 32ms batches, so streaming chunk bursts never stall the loop
- **SVG icons with graceful fallback**: official DSH icons are pre-rendered to PNGs (`bun run icons`) and shown through Kitty/Sixel graphics when available, with Unicode glyphs as the universal fallback
- **Single Solid runtime**: the build rewrites bare `solid-js` imports to the client entry (`solid-js/dist/solid.js`) so the bundle and `@opentui/solid` share one runtime — two runtimes break the renderer context
- **Delayed tool settlement**: millisecond tools (reads, greps) hold their running state for ~600ms so the shine animation stays visible
- **Self-healing connection**: a 20s no-frame watchdog forces a reconnect and rebuilds the conversation from durable history
- **Keyboard compatibility**: legacy escape sequences, DECCKM and kitty CSI-u codes are all handled

## Project layout

```
bin/              CLI entry shell
assets/           icons-src/ (SVG sources) + icons/ (generated PNGs)
cordis.patch.yml  dsh plugin patch (profile row config)
scripts/          build.ts build script, icons.mjs icon pipeline, mock-dsh-server.mjs dev mock
src/
  cli.tsx         OpenTUI entry
  app.tsx         app shell
  screens/        home / session screens
  harness/        session driver, transport, event folding, tool-row models
  components/     UI components
  dsh/            Cordis plugins (startup / runner / dispatcher / types)
  assets-icons.ts generated icon data-URL module
test/             Bun tests (protocol, folding, rendered frames, interactions)
```

## License

MIT

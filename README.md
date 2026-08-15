# DeepSeek Harness CLI

A terminal agent for **DeepSeek Harness (DSH)**. An opencode-style TUI with the
DeepSeek **小鲸鱼 (little whale)** thinking animation.

Two modes:

- **Connected** (default when a harness is reachable): drives a real DeepSeek
  Harness session through its `/api` — sessions, tools, permissions, plan mode
  and history all live in the harness. No local API key needed.
- **Standalone**: runs its own agent loop and talks to the DeepSeek API
  directly (needs `DEEPSEEK_API_KEY`), covering the full DSH tool surface.

## Quick start: the OpenCode-style TUI

`dsh-tui` starts a local OpenCode-compatible bridge and attaches the vendored
OpenCode TUI to it, so a running DeepSeek Harness session renders as a
full OpenCode terminal client branded **DeepSeek Harness CLI**.

```sh
npm run build
npm link
dsh-tui                 # start in the current project
dsh-tui path/to/project # start in a specific project
dsh-tui --continue      # reopen the most recent session
```

No `dsh web` process is required first. `dsh-tui` talks directly to DeepSeek
Harness at `DSH_CLI_HARNESS_URL` (default `http://127.0.0.1:3080`).

```
        o
       o
   .-""""-.  ~~~
  /        \  ~
 |   o  o   | ~
 |    ^     |
  \        /  ~
   '-....-'  ~~~
```

## Use it as a DeepSeek Harness component

DeepSeek Harness CLI is packaged as a **Cordis plugin** (like `dsh-headless`), so it can be
mounted as a profile bundle inside the harness process — plus a standalone
`dsh-cli` binary and a reusable `./client` library.

| Entry | Purpose |
|---|---|
| `dsh-cli` (bin) | standalone CLI: auto-connects to a local harness, or runs its own agent |
| `dsh-cli/cordis` (`.` / `./startup`) | Cordis plugin `{name, inject, apply}` for `dsh --profile cli` |
| `dsh-cli/client` | `HarnessClient` + event folding for other tools |

As a plugin it runs **in-process** (like headless): it creates a host agent
through `agents.create`, drives it with `followup`/`whenIdle`, folds the host
`session/event` bus into the TUI, and bridges permission/ask/plan questions
from the host `userQuestions` service to the terminal modal. No HTTP, no local
API key — sessions, tools, permissions and history are the harness's own.

```sh
# 1. publish (or pack locally) — the package declares dsh.bundle.patch
npm publish                     # or: npm pack

# 2. create a profile that mounts the bundle
dsh plugin --profile cli add deepseek-harness-cli

# 3. run it like any harness app
dsh --profile cli "refactor this module"   # one-shot headless run
dsh --profile cli                          # interactive TUI
```

The bundle's `cordis.patch.yml` inserts the `cli-startup` loader row
(`dsh-cli/startup`) over `@deepseek-ai/dsh-base`; the launcher hands inner
arguments through `ctx.cmdlineArgs`, so `--resume`/`--new` style flags belong
to the app just like `dsh --profile web --port 8080`.

## Connected mode (drive a running harness)

If a DeepSeek Harness web instance is running locally, `dsh-cli` auto-detects
it and connects — just run it:

```sh
dsh-cli                    # auto-detect → connected TUI
dsh-cli "refactor this"    # connected headless
dsh-cli --connect          # explicit (default http://127.0.0.1:3080)
dsh-cli --connect http://host:8080   # remote harness
dsh-cli --standalone       # force the local agent instead
```

The CLI implements the harness `/api` client contract: unary RPC
(`POST /api/<method>` with a `client-request` envelope) and a WebSocket
downlink on `/api/events.mux` (session events, `assistant/chunk` token deltas,
tool calls, permission/ask-user questions, plan reviews, todo/plan
projections). Sessions are created, resumed and titled inside the harness;
permission questions surface as the same TUI modal as standalone mode
(headless answers automatically: first option, or deny for permissions unless
`-y`).

## Features

| Area | Tools / behavior |
|---|---|
| Shell | `bash` with exit codes, stderr, timeout, abort on Ctrl+C |
| Filesystem | `fs_read`, `fs_write`, `fs_edit` (string replace), `fs_ls`, `fs_glob`, `fs_grep`, `fs_delete` |
| Web | `web_search` (DuckDuckGo cascade: html → lite → instant-answer), `web_fetch` (HTML→text) |
| Interaction | `ask_user` with a TUI modal (choices, Esc to cancel) |
| Planning | `todo_write`/`todo_list`, plan mode (`exit_plan_mode` with approve/revision/reject review), `goal` (create/get/update) |
| Delegation | `subagent` (foreground/background), `jobs_list`/`job_output`/`job_kill` |
| Orchestration | `workflow` — sandboxed JS scripts with `agent`/`pipeline`/`parallel`/`phase`/`log`/`args` |
| Skills | `skill_list`/`skill_load` from `~/.dsh-cli/skills/<name>/SKILL.md` |
| MCP | stdio MCP servers via config (`mcpServers`), tools exposed as `mcp__<server>__<tool>` (standalone only) |
| Reasoning | `deepseek-reasoner` support — `reasoning_content` streams into a 💭 thinking block |
| Sessions | JSONL history (standalone) / harness history (connected), `--resume`, `--continue`, `--list-sessions`, title auto-naming |
| Modes | Interactive TUI, headless (`dsh-cli "prompt"`), piped stdin |

## Install & run

```sh
npm install
npm run build          # bundles dist/cli.js
export DEEPSEEK_API_KEY=sk-...      # or put it in ~/.dsh-cli/config.json
node dist/cli.js                     # interactive TUI
node dist/cli.js "write the tests"   # headless
```

Or link it: `npm link` → `dsh-cli` on your PATH.

## TUI

```
┌──────────────┬──────────────────────────────────────────────┐
│ 🐳 DeepSeek Harness CLI│  You · 8:07 PM                    │
│ [Sessions]   │  fix the flaky test                          │
│  Todos  Plan │                                              │
│ ● hello      │  🐳 · 8:07 PM                                │
│   fix bug    │  💭 thinking                                  │
│              │  ● bash  $ npm test             ✓            │
│  ☐ task 1    │  All done — the suite is green now.          │
│  ☑ task 2    │                                              │
│ Plan: off    ├──────────────────────────────────────────────┤
│              │ ❯ ask anything…                      [model] │
│              │ 🐳 deepseek-chat · hello  ready · ~/proj     │
└──────────────┴──────────────────────────────────────────────┘
```

Keys: `⏎` send · `Ctrl+C` stop agent / quit when idle · `Ctrl+N` new session ·
`Ctrl+R` session list · `Ctrl+E` plan mode · `Ctrl+M` switch model (chat ⇄
reasoner) · `Tab` chat ⇄ sidebar · `↑↓` history / list · `PageUp/Down` or
`Shift+↑↓` scroll · `Esc` clear input.

While the model thinks, the **little whale dives**: spout and bubbles rise, the
tail wiggles, and it blinks — `DeepSeek 小鲸鱼 · diving for answers`.

## CLI

```
dsh-cli [options] [prompt]

  -p, --prompt <text>    headless run
  -m, --model <name>     deepseek-chat | deepseek-reasoner
      --reasoner         shorthand for -m deepseek-reasoner
  -y, --yes              auto-approve dangerous tools
      --plan             start in plan mode
      --connect [url]    connect to a running harness (default: auto-detect
                         http://127.0.0.1:3080; env: DSH_CLI_HARNESS_URL)
      --standalone       force the local agent instead of connecting
      --resume <id>      open a session
      --continue         resume the most recent session
      --new              fresh session
      --list-sessions    list sessions
  -c, --cwd <dir>        workspace root
  -t, --max-turns <n>    headless tool-round cap (default 50)
      --api-key <key>    env: DEEPSEEK_API_KEY
      --base-url <url>   default https://api.deepseek.com
```

## Configuration (`~/.dsh-cli/config.json`)

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com",
  "autoApprove": false,
  "instructions": "Always run tests after editing code.",
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
  }
}
```

Override the data home with `DSH_CLI_HOME` (sessions, config, skills live
there). Environment: `DEEPSEEK_API_KEY`, `DSH_CLI_MODEL`, `DSH_CLI_BASE_URL`,
`DSH_CLI_AUTO_APPROVE`.

## Permission model

- Read-only tools (`fs_read`, `web_*`, `todo_*`, …) run automatically.
- Mutating tools (`bash`, `fs_write`, `fs_edit`, `fs_delete`, `workflow`) ask in
  the TUI (Allow / Always allow / Deny). `-y` auto-approves; headless without
  `-y` denies.
- Plan mode blocks all mutating tools until the plan is approved via
  `exit_plan_mode`.

## Development

```sh
npm run typecheck      # tsc --noEmit
npm run build          # esbuild → dist/cli.js
npm run mock           # mock LLM server (SSE + tool calls) on :18765
```

Test headless against the mock:

```sh
export DSH_CLI_BASE_URL=http://127.0.0.1:18765 DEEPSEEK_API_KEY=mock-key
node dist/cli.js -p "hello"            # bash tool call → final answer
node dist/cli.js --plan -p "plan"      # plan-mode gating → approval
node dist/cli.js -y -p "workflow"      # workflow with parallel subagents
```

## Known simplifications vs. DSH

- Standalone mode has no sandboxing/containers: tools run with the invoking
  user's permissions (permission prompts are the guard; `-y` opts out).
- Connected mode delegates tools/permissions entirely to the harness; the CLI
  only renders and relays questions.
- Web search uses DuckDuckGo (no API key); on bot-gated networks it falls back
  to the zero-click/instant-answer result.
- Standalone subagents share the session's approval center; in headless mode
  without `-y` their mutating tools are denied.
- MCP supports stdio transports only (standalone mode); tools default to `ask`
  unless the server marks them read-only.
- In connected mode, plan mode and todos are owned by the harness (projections
  sync them into the sidebar); Ctrl+E just re-reads the harness state.

# dsh-bridge

OpenCode/MiMo TUI compatible bridge backed by DeepSeek Harness's web API.

## Run

```bash
# start bridge only
pnpm bridge -- --dsh-url http://127.0.0.1:3080 --port 4096

# start bridge and attach a local MiMo/OpenCode TUI
pnpm tui -- --dsh-url http://127.0.0.1:3080 --port 4096
```

`pnpm tui` defaults to launching `opencode attach http://127.0.0.1:4096`. Override
the attach command with `DSH_TUI_ATTACH_COMMAND`, for example:

```bash
DSH_TUI_ATTACH_COMMAND="bun /path/to/opencode/packages/opencode/src/index.ts attach" pnpm tui
```

## Endpoints

The bridge exposes the core OpenCode server routes required by the TUI:

- `GET /global/health`
- `GET /global/event`
- `GET /session`
- `POST /session`
- `GET /session/:id`
- `GET /session/:id/message`
- `POST /session/:id/message`
- `POST /session/:id/prompt_async`
- `POST /session/:id/abort`
- `GET /session/:id/todo`
- `GET /command`
- `POST /session/:id/command`

DSH events are projected into OpenCode-shaped sessions, messages, parts,
todos, and status events.

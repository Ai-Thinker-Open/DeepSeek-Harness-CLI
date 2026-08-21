# DeepSeek Harness CLI（`dsh-cli`）

![DeepSeek Harness CLI](assets/deepseek-harness-cli.png)

基于 [OpenTUI](https://github.com/opentui/opentui) 0.5.x + SolidJS 构建的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness) 终端客户端。

它直接驱动本地运行的 DeepSeek Harness 实例：会话、工具调用、权限审批、计划模式、历史记录全部由 harness 持有，本客户端负责把它们渲染成一个流畅的终端界面——MiMo 风格启动屏、工具卡片动画，并在终端支持 Kitty/Sixel 图形协议时显示真正的 SVG 图标。**不需要本地 API Key。**

```
   dsh-cli                    # 探测并连接本地 harness
   dsh-cli -c                 # 直接恢复最近一次会话
   dsh --profile tui          # 作为 harness 组件以 TUI 模式启动
```

## 功能特性

- **会话管理**：新建 / 恢复 / 重命名 / 分叉会话，`-c` 快速续接最近会话
- **流式渲染**：正文、推理（Think 块）、工具调用增量实时渲染，30fps 下保持流畅
- **工具卡片**：Bash / Read / Edit / Write / Search / Code / Todo / Question / Terminal / Job 等工具行分类，含摘要、展开正文、diff 查看器与运行闪光动画；行首图标使用 DSH web 客户端官方 SVG（预渲染为 PNG），通过 Kitty / Sixel 图形协议显示，不支持时自动回退 Unicode 字形
- **Think 块**：推理内容以可折叠块呈现，与工具行共用闪光动画和 hover 折叠箭头交互
- **权限审批**：harness 抛出的权限 / 提问 / 计划审批以弹窗呈现，↑↓ 选择、Enter 确认、Esc 拒绝
- **计划模式**：`/plan` 进入 / 退出计划模式，徽标实时反映 `active/pending` 状态
- **Slash 命令**：本地命令 + harness 宿主命令 + 技能统一收录在 `/` 菜单
- **队列停靠**：待发 / 引导中的消息可直接编辑、移除或发送
- **统计栏**：轮次、步骤、LLM/工具耗时、首 token 平均、缓存命中率、token 用量
- **健壮连接**：断线自动重连、流式卡死看门狗、从持久历史恢复会话

## 环境要求

- [Bun](https://bun.sh)（构建与运行均依赖 Bun；`dist/cli.js` 由 Bun 执行）
- 本地可选的 DeepSeek Harness 实例（`dsh-cli` 会自动探测并拉起）

## 安装

1. **安装 Bun**（构建与运行必需）：

   ```sh
   curl -fsSL https://bun.sh/install | bash   # 或用你的包管理器安装
   ```

2. **安装 DeepSeek Harness CLI（可选）**——`dsh-cli` 也可以通过 npx 自动拉起 harness，但全局安装能让启动更快：

   ```sh
   npm install -g @deepseek-ai/dsh
   ```

3. **从源码安装 `dsh-cli`**：

   ```sh
   git clone git@github.com:Ai-Thinker-Open/DeepSeek-Harness-CLI.git
   cd DeepSeek-Harness-CLI
   bun install
   bun run build
   bun link          # 把全局 `dsh-cli` 命令暴露出来
   ```

然后运行 `dsh-cli`（或 `dsh-cli -c`）。首次启动若 `dist/` 缺失会自动构建，没有运行中的 harness 时也会自动拉起。

## 快速开始

```sh
bun install
bun run build        # 产出 dist/cli.js, dist/startup.js, dist/runner.js, dist/dispatcher.js
bun link             # 可选：把 bin/dsh-cli 装到全局
```

然后直接运行：

```sh
dsh-cli              # 自动探测 http://127.0.0.1:3080 上的 harness
                     # 没有则自动安装 tui profile 并拉起 dsh --profile tui
dsh-cli -c           # 恢复最近一次会话并直接进入
```

`bin/dsh-cli` 是薄壳：`dist/` 缺失时先自动构建，再把参数转交给 `dist/dispatcher.js`。

### 作为 DeepSeek Harness 组件运行

本包同时是一个 Cordis 插件（通过 `package.json` 的 `dsh.bundle.patch` 挂载 `cordis.patch.yml`），可以像其它 harness 界面一样启动：

```sh
dsh --profile tui                        # 以 TUI 模式启动 harness + 终端客户端
dsh --profile tui --port 0               # 让系统分配空闲端口
dsh --profile tui --cwd ~/my-project     # 指定会话工作区
dsh --profile tui -c                     # 恢复最近会话
```

启动后 `tui-runner` 插件会读取已绑定的 web server 地址，通过 `DSH_URL` / `DSH_CWD` 拉起终端客户端，并在客户端退出时关闭整个 dsh 进程。

### 命令行选项（`dsh --profile tui`）

| 选项 | 说明 |
|---|---|
| `--host <host>` | 绑定地址，仅允许回环 `127.0.0.1`（默认值） |
| `--port <port>` | 监听端口，`0` 表示由系统分配（默认 `3080`） |
| `--cwd <dir>` | 新会话的工作目录（默认调用目录） |
| `-c, --continue` | 启动时恢复最近一次会话 |
| `-h, --help` | 显示帮助 |

> `dsh-cli -c` 也会把 `--continue` 转发给客户端。

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_URL` | harness 地址（默认 `http://127.0.0.1:3080`） |
| `DSH_CWD` | 会话工作目录（默认当前目录） |
| `DSH_DEBUG` | 置 `1` 时输出协议与调试日志 |
| `DSH_HOME` | harness 数据目录（默认 `~/.dsh`） |
| `DSH_NPX_CACHE` | npx 缓存目录，加速 `dsh` 解析（默认 `~/.npm/_npx`） |
| `DSH_TOOLS_MODE` | 进程级 Code Mode 开关（透传给 tools 行） |
| `OPENTUI_IMAGE_PROTOCOL` | 图标渲染协议覆盖：`auto` / `kitty` / `sixel` / `blocks` |
| `OPENTUI_GRAPHICS` | 置为 `false` 关闭 Kitty/Sixel 检测（图标回退为字形） |

## 常用操作

| 操作 | 说明 |
|---|---|
| `Tab` / `Shift+Tab` | 切换权限预设：`read-only` → `workspace-write` → `full-access` |
| `/` | 打开命令菜单（本地 / host / 技能，按前缀过滤） |
| `Esc` | 关闭菜单 / 返回主页 / 拒绝当前问题 |
| `Enter` | 发送消息 / 确认选择 |
| `↑↓` | 菜单与选项移动 |
| 鼠标 | 点击展开工具卡片、队列行；hover 工具行显示折叠箭头；拖动选择文本（OSC52 复制） |
| `Ctrl+C` | 退出 |

### Slash 命令

- **本地**：`/sessions`、`/resume`、`/model`、`/rename`、`/fork`、`/help`
- **host**（由 harness 执行）：`/compact`、`/feedback`、`/goal`、`/plan`、`/permission`、`/export`
- **技能**：会话的技能目录会并入 `/` 菜单，作为普通消息交给模型
- **MCP 风格**：`/server:tool` 形式的输入走消息通道

## 开发

```sh
bun run dev           # 直跑 src/cli.tsx（需先有一个 harness 或 mock）
bun run dev:debug     # DSH_DEBUG=1 的调试模式
bun run icons         # 重新渲染 SVG 图标为 PNG，并重新生成 src/assets-icons.ts
bun run build         # 打包 dist/（把 solid-js 固定到客户端运行时）
bun run typecheck     # tsc --noEmit
bun test              # 全量测试（协议 / 事件折叠 / 渲染帧 / 交互）
```

### 图标

工具与 Think 图标以 SVG 形式存放在 `assets/icons-src/`：来源是 DSH web 客户端官方图标集（deepseek-ai/DeepSeek-Harness 的 `packages/client/ui-primitives/src/icons`），另有 TUI 专属的 `terminal` 自绘图标（`job` 使用官方齿轮图标）。`bun run icons` 会把每个图标渲染成 `assets/icons/` 下的 64×64 PNG，并重新生成 `src/assets-icons.ts`（base64 data URL 模块），因此 bundle 不依赖运行时资源路径。界面上的 `ToolIcon` 在终端支持 Kitty / Sixel 图形协议时渲染 PNG（2 格宽），否则回退 Unicode 字形；tmux、普通 SSH 会话会自动使用字形。

没有真实 harness 时，用内置 mock 服务器联调 TUI：

```sh
bun scripts/mock-dsh-server.mjs           # 监听 127.0.0.1:3080
PORT=3456 bun scripts/mock-dsh-server.mjs # 换端口
MOCK_SLOW=1 bun scripts/mock-dsh-server.mjs  # 放大时序便于观察流式动画

DSH_URL=http://127.0.0.1:3080 bun run dev
```

mock 服务器实现了 DSH 协议（`/api/<method>` 一元 RPC、`events.mux` WebSocket 下行、`/api/respond`），收到 "ask …" 会触发权限提问，其余消息会按关键词回放一轮带工具调用的脚本回合（bash / read / grep / edit），方便观察工具卡片的闪光动画。

## 架构概览

```
bin/dsh-cli                   入口壳（缺 dist 自动构建）
  └─ src/dsh/dispatcher.ts    探测已有 harness → 直接跑 TUI；否则拉起 dsh --profile tui
dsh 进程内（cordis.patch.yml）
  └─ src/dsh/startup.ts       --host/--port/--cwd/-c 解析，提供 tuiStartup 服务
  └─ src/dsh/runner.ts        读 webServer 地址，spawn dist/cli.js，客户端退出时关停 dsh
TUI 进程
  └─ src/cli.tsx              OpenTUI renderer 配置
  └─ src/app.tsx              应用外壳：屏幕切换 / 权限模式 / toast / 命令路由
  └─ src/screens/*            home 与 session 两个屏幕
  └─ src/harness/session.ts   会话驱动核心：事件折叠 / mux 循环 / 重连 / 统计
  └─ src/harness/client.ts    DSH /api HTTP + events.mux WebSocket 传输
  └─ src/harness/fold.ts      事件 → ChatMessage 纯函数
  └─ src/harness/tool-card.ts 工具行分类 / 摘要 / 卡片模型 / diff
  └─ src/components/*         16 个 UI 组件（prompt / message-view / markdown / logo / tool-icon …）
  └─ src/assets-icons.ts      生成的图标 data-URL 模块（见 scripts/icons.mjs）
```

### 关键设计

- **双重身份**：同一个包既可作为独立 CLI，也可作为 Cordis 插件在官方 `dsh` 进程内运行
- **只渲染变化**：Solid `<For>` 按对象身份 memoize，配合脏标记 32ms 批量刷新，流式 chunk 洪峰下不卡顿
- **SVG 图标 + 优雅回退**：官方 DSH 图标预渲染为 PNG（`bun run icons`），终端支持 Kitty/Sixel 时用图形协议显示，否则统一回退 Unicode 字形
- **单一 Solid 运行时**：构建时把裸 `solid-js` 导入改写为客户端入口（`solid-js/dist/solid.js`），保证 bundle 与 `@opentui/solid` 共享同一运行时——双运行时会破坏渲染器上下文
- **快速工具延迟结算**：读文件等毫秒级工具的结果延迟 600ms 呈现，让运行闪光动画可见
- **自愈连接**：downlink 卡死 20s 触发看门狗 → 重连 + 从持久历史重建会话
- **键盘兼容**：同时处理传统转义序列、DECCKM 与 kitty CSI-u 协议

## 目录结构

```
bin/              CLI 入口壳
assets/           icons-src/（SVG 源）+ icons/（生成的 PNG）
cordis.patch.yml  dsh 插件补丁（profile 行配置）
scripts/          build.ts 构建脚本、icons.mjs 图标管线、mock-dsh-server.mjs 开发用 mock
src/
  cli.tsx         OpenTUI 入口
  app.tsx         应用外壳
  screens/        home / session 屏幕
  harness/        会话驱动、传输、事件折叠、工具行模型
  components/     UI 组件
  dsh/            Cordis 插件（startup / runner / dispatcher / types）
  assets-icons.ts 生成的图标 data-URL 模块
test/             Bun 测试（协议、折叠、渲染帧、交互）
```

## License

MIT

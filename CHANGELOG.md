# Changelog

## v0.3.4 — 2026-08-30

修复：首页打开的模型选择面板（`/model`，唯一使用外部 `resultOverride` 的命令）会跨屏带进会话界面并在对话页一直显示。现在从首页进入会话的瞬间统一清空该外部面板，覆盖所有入口（发消息、`/sessions`/`/resume` 点击恢复、`/plan <任务>`、技能/MCP 注入、自动恢复）；输入框在外部面板被清空时同步关闭镜像面板。新增组件级回归测试。

## v0.3.3 — 2026-08-29

图片附件：让 DeepSeek Harness 真正收到图片（视觉模型看图）。

- 双通道添加图片：`Ctrl+V` / `/image clipboard` 读取宿主剪贴板图片（剪贴板只有文本时按文本粘贴），`/image <路径>` 附加本地图片；Windows 风格路径（`D:\...`）在 WSL 下自动转 `/mnt/d/...`，剪贴板原生读取不可用时尝试 Windows PowerShell 兜底。
- 剪贴板识别增强：从资源管理器复制图片文件时，剪贴板里是文件路径——现在会自动识别并作为图片附件（单行且指向存在的图片才触发，多行/普通文字仍按文本粘贴）。
- 图片以 Harness 协议内容块发送（`session.prompt` 的 `{type:"image", mediaType, data}`，canonical base64），单张 ≤5MiB、单条 ≤20 张等限制按 harness 的 `imageLimits` 投影执行；非视觉模型会提示切换。
- 输入区附件条：缩略图/名称/大小，点击 ✕ 或空稿 Backspace 移除；提交时按「图片 + 文本」顺序组装内容块，纯图片消息也可发送。
- 会话内渲染：Kitty/Sixel 终端显示真实缩略图，其余终端回退 `🖼 名称` 标签；历史消息通过新增的 `session.attachment` RPC 拉取并缓存，失败显示占位。
- 队列/取消链路适配图片消息（按签名匹配乐观副本、按 messageId 重新投递），slash 命令可携带图片（`commands/execute` 的 `images` 参数）。
- mock server 支持图片端到端演练：图片块转 durable 附件引用、`session.attachment` 回传 base64。
- 多实例并存：`dsh --profile tui` 默认端口 3080 被占用时（含 Windows 侧实例经 WSL2 localhost 转发造成的隐形占用）自动改用空闲端口并提示，不再 EADDRINUSE 失败；显式 `--port` 始终优先，多个 `dsh-cli` 客户端可复用同一 harness。
- Windows→WSL2 粘贴图片打通：Windows Terminal 会把 `Ctrl+V` 拦截成终端粘贴（应用收不到按键），现在监听粘贴事件——粘贴文本照常插入、粘贴的图片文件路径自动转附件、空粘贴（剪贴板只有图片，如截图）自动读宿主剪贴板取图；宿主剪贴板读取失败（如无 WSLg）时也尝试 Windows PowerShell 兜底。修复绝对路径以 `/` 开头被误判为命令的问题。
- WSL 下先探测 Windows 剪贴板（PowerShell）再读原生剪贴板：WSLg 在 Windows 剪贴板只有图片时会返回空文本，旧逻辑会把它当成"剪贴板里是空文本"而什么都不插入（表现就是 Ctrl+V 无反应）——现在 Windows 侧图片优先命中，实测 Windows 截图可正常附加；PowerShell 返回的图片额外校验魔数，避免把错误输出当 PNG 发给 harness。
- 多行粘贴折叠（对齐 Codex）：粘贴内容 ≥5 行 或 ≥1000 字符（Unicode 码点）时不再把全文塞进输入框，折叠为首行缩略条 `📋 首行… [已折叠 N 行 · M 字符 · Ctrl+E]`；全文在提交时逐字发送（不 trim），`Ctrl+E` 或点击折叠条展开编辑，`Esc` 丢弃折叠，发送历史保存展开后的完整文本；折叠内容以 `/` 开头也不会被误判为 slash 命令。

## v0.3.2 — 2026-08-28

更新改为在 TUI 内进行，完成后自动重启；跳过更新仍可正常使用当前版本。

- 批准更新后不再退出 TUI 去后台安装：TUI 内显示更新进度（下载/安装到临时目录、校验、完成），更新脚本通过状态文件回报进度。
- 更新完成短暂退出 TUI（Windows 上需要先释放 `opentui.dll` 才能替换文件），随后**在同一终端**自动重启新版本，不再弹出新窗口。
- 更新失败不阻塞使用：界面提示失败原因，按 Enter 继续使用当前版本。
- 「暂不更新」保持不变：跳过不影响任何功能，后续启动仍会提示。
- 自更新脚本改为同终端运行（去掉 `detached` 新窗口行为），并保留状态文件/退出标记的协调机制。
- 消息中内联代码（命令/文件名/路径）取消背景块渲染，只保留强调色文字。
- 按键调试日志写入系统临时目录（`%TEMP%\dsh-cli-keys.log`），Windows 上不再静默失败，便于排查快捷键。
- 目录确认默认选中项随敏感度变化：普通目录默认「信任此工作目录（记住）（推荐）」，按 Enter 直接允许运行；主目录/根目录默认「退出（推荐）」。
- 待发送消息的发送时机改为「当前动作执行完成后」：运行中输入的新消息走 harness 的 next-step 注入（与 Codex 一致），不再等整轮会话结束才发送。
- 修复：Esc 取消当前动作时不再丢失待发送消息——取消后自动重新投递（steer），避免 dock 留下无法发送的僵尸项；想放弃消息可在取消前用 dock 的 ✕ 移除。
- DeepSeek API Key 输入弹窗简化：去掉 🔑 表情与强调色，改为朴素的中性边框与普通标题。
- 修复：首次启动拉起 FlashKey MCP 后台守护进程时不再弹出新终端窗口（Windows 上 detached 子进程默认新建控制台，现通过 `windowsHide` 静默启动）。

## v0.3.1 — 2026-08-28

目录风险确认改为阻塞式启动门：先提示风险，再进入首页/会话。

- 风险判断在首帧渲染前同步完成：首次在某目录启动时，全屏显示目录确认，确认后才渲染首页；不再出现“先显示首页再弹提示”。
- 普通目录确认后写入 `~/.dsh/confirmed-workspaces`，同目录后续启动不再提示；按钮文案改为「信任此工作目录（记住）」。
- 主目录 / 文件系统根目录每次启动都显示红色高危警告，确认仅限本次（不持久化），文案保持「我了解风险，仅本次信任」。
- `DSH_SKIP_RISK_CONFIRM=1` 仍可完全跳过；`-c`/`--continue` 同样先过风险门再恢复会话。
- 测试新增“风险弹窗打开时首页不可见”断言；全套 249 个测试通过。

## v0.3.0 — 2026-08-28

标准 DeepSeek Harness 插件化重构：依赖走官方 npm 平台包、插件补齐 Config schema、安装期不再改动全局环境、harness 保持自动最新。

### 插件与依赖（标准 DeepSeek Harness 插件形态）

- `@opentui/core` / `@opentui/solid` 升级并精确锁定 `0.5.9`（官方 npm 包；0.5.7–0.5.9 无破坏性变更），`solid-js` 与官方 peer 精确对齐 `1.9.12`。
- OpenTUI 原生库不再随包体 vendored（移除 `vendor/opentui-native` 与 `OTUI_ASSET_ROOT` 注入），改由官方平台包 `@opentui/core-<平台>-<arch>` 在安装时按当前平台解析；npm 包体积 48.8MB → 12MB。
- Bun 不再要求全局安装：`@oven/bun-<平台>-<arch>@1.3.14` 作为 optionalDependencies 随包分发，`resolveBun()` 优先使用包内二进制（Linux musl 自动选 musl 包），保留 `~/.bun` 与 PATH 回退。
- `tui-runner` 补齐标准 `Config` 接口 + 同名 Schemastery schema（host/port/cwd/continueLast 默认值进 schema），满足 Cordis 插件配置约定。
- 新增依赖 `@deepseek-ai/schemastery@3.18.1`（构建时打进 `dist/runner.js`）。

### 安装语义与 harness 自动更新

- **移除 postinstall 全局副作用**：不再自动安装 dsh / pnpm / bun、不再在安装时创建 profile；改由首次启动时补齐并注册（`bin/dsh-cli` 运行时可自动兜底）。
- **harness 保持最新**：每次由 `dsh-cli` 拉起 harness 前查询 npm registry 的 `@deepseek-ai/dsh` 最新版，发现新版自动 `npm install -g @deepseek-ai/dsh@<最新版>`（复用已有 harness 或 `DSH_NO_UPDATE_CHECK=1` 时跳过；更新失败仅提示、不阻塞启动）。
- pnpm 11 `allowBuilds` 残留占位符（`set this to true or false`）改为每次启动前幂等修复，升级用户无需手动 `pnpm approve-builds`。

### 其他

- `scripts/ensure-runtime.mjs`、`scripts/vendor-resources.ts`、`src/dsh/native-assets.ts` 删除；`prepack` 只执行构建。
- 中英文 README 更新安装方式、内置资源说明与 `dsh plugin --profile tui add @ai-thinker/deepseek-harness-cli` 标准插件安装路径。
- 测试新增：harness 自动更新、`resolveBun` @oven 优先、runner Config schema、打包清单不含安装期脚本；OpenTUI 0.5.9 下全套 249 个测试通过。

## v0.2.15 — 2026-08-26

首个包含启动更新检查、目录风险确认与完整交互打磨的发布。安装方式：

```sh
# 全局安装（推荐）
npm install -g @ai-thinker/deepseek-harness-cli

# 或临时体验（npx 不触发安装时 bootstrap，缺失项首次启动自动补齐）
npx @ai-thinker/deepseek-harness-cli
```

### 新增

- **启动前更新检查**：对比 npm 最新版本，有新版时弹窗让用户审批更新（立即更新 / 暂不更新）；批准后退出 TUI、后台 `npm install -g` 并自动重启。`DSH_NO_UPDATE_CHECK=1` 可禁用。
- **目录风险确认门**：启动前确认工作目录；主目录 / 文件系统根目录每次红色强警告，普通目录首次确认后跳过（`~/.dsh/confirmed-workspaces`）。`DSH_SKIP_RISK_CONFIRM=1` 可禁用。
- **输入框历史**：↑/↓ 像终端历史一样在已发送消息间切换。
- **Ctrl+Enter 换行**：Enter 提交，Ctrl+Enter 插入换行（多行草稿）。
- **队列消息只在待发送列表**：被 harness 排队的消息不再进对话区，agent 真正接收后再回显。
- **统计栏悬停延时**：鼠标停 500ms 才弹出详情。
- **斜杠菜单分类**：技能 → “技能”、MCP 工具 → “MCP”、其余 → “快捷”；MCP 工具通过 SSE `tools/list` 自动发现。
- **`/mcp` 命令**与底部实时 MCP 状态（3s 轮询，`N MCP /mcp`）。

### 修复与打磨

- 评审 / 权限弹窗不再清空输入框草稿（快照 + `setText` 恢复）。
- 修复长 diff 截断后 “Hunk at line 3 contained invalid line” 渲染错误。
- Windows 客户端连 WSL harness 时自动把 `D:\...` 翻译为 `/mnt/d/...`。
- Windows 上拦截 bun 1.4+（OpenTUI 段错误），启动前给出降级指引。
- 自动清除 Git Bash 子进程错误输出（如 ssh 的 “couldn't create signal pipe”）对输入框的污染。
- 自动修复损坏的技能软链；vendor 资源不再因一次失败的克隆被误删。
- 指令执行渲染对齐 Codex 风格（工具名主色、完成/失败标记）；消息中的命令/路径用强调色；`Pwsh` 标题改为 `Shell`。
- 光标使用终端默认样式（与系统一致），颜色与内容一致。
- 大量测试补充与稳定性修复。

### 安装时会安装 / 检查的包（知情说明）

- `@ai-thinker/deepseek-harness-cli` 本体（内置 Ai-Thinker 技能、FlashKey MCP 源码、OpenTUI 原生库等 vendored 资源）。
- `bun@1.3.14`：终端客户端运行时（Windows 上避开 1.4 崩溃；版本不符会自动重装）。
- `@deepseek-ai/dsh`：DeepSeek Harness 服务端（缺失时自动安装）。
- `pnpm`：harness 构建 tui profile 所需（缺失时自动安装）。
- 首次启动 bootstrap（可跳过）：链接 vendored 技能到 `~/.dsh/skills`、向 tui profile 注册 FlashKey MCP、尝试安装 `flashkey-mcp`（Python，失败不影响启动）。

相关环境变量：`DSH_HOME`、`DSH_URL`、`DSH_CWD`、`DSH_DEBUG`、`DSH_SKIP_BOOTSTRAP`、`DSH_NO_SKILLS`、`DSH_NO_FLASHKEY`、`DSH_NO_UPDATE_CHECK`、`DSH_SKIP_RISK_CONFIRM`、`FLASHKEY_SSE_PORT`、`AT_SKILLS_URL`。

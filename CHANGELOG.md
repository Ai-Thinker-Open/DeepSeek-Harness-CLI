# Changelog

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

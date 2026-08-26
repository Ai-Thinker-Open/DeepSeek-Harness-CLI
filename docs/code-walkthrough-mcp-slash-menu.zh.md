# 近期改动走读：MCP 状态同步、斜杠菜单分类与 diff 渲染修复

> 本文档记录 0.2.13 开发轮次里几个相互关联的改动，供后续维护时快速恢复上下文。
> 内容按“用户实际使用路径”组织：数据源 → 底部状态 → 斜杠菜单分类 → `/mcp` 命令 → diff 渲染。

## 1. 数据源：src/mcp.ts

原实现是占位（`getMcpServers()` 直接返回 `[]`），底部“0 MCP”永远不会变。现在拆成四层：

### 1.1 配置读取

[parseMcpServers](/home/seahi/workspace/dsh-cli/src/mcp.ts:39) 用状态机逐行扫描 profile 的 patch 文件：

- 遇到 `- insert:` / `- id:` 行先把上一个块收尾（`flush()`），保证块间不串数据；
- 只认 `name: '@deepseek-ai/dsh-mcp-client'` 的行开始收集；
- 之后按 `serverName` / `url` / `command` / `args:` 四个正则逐行抓取；
- stdio 服务器的 `args` 用 `inArgs` 标志控制：只有进入 `args:` 段后才收 `- xxx` 行，避免误收 `- id:` 这类行。

[configuredMcpServers](/home/seahi/workspace/dsh-cli/src/mcp.ts:94) 扫描 `<DSH_HOME>/profiles/tui/` 下所有 `*.patch.yml`（含 `cordis.patch.yml`）并合并结果。配置文件解析失败只跳过该文件，不阻塞启动。

> 维护提示：解析逻辑依赖 bootstrap 写入的固定格式（[bootstrap.ts](/home/seahi/workspace/dsh-cli/src/dsh/bootstrap.ts:95) 的 `applyMcpPatch`）。如果 profile 的 patch 结构变化（比如 dsh 升级改了配置块格式），需要同步更新这里。

### 1.2 状态探测

[probeServer](/home/seahi/workspace/dsh-cli/src/mcp.ts:110) 对 SSE 地址发一个带 1.5s 超时的 GET：

- `!res.ok` 直接判 `failed`；
- 读一个 chunk 确认流真的开始输出才判 `connected`（防止“能连上但从不响应”的假阳性）；
- 任何异常（超时、拒绝连接）都归为 `failed`。

[refreshMcpStatus](/home/seahi/workspace/dsh-cli/src/mcp.ts:130) 对每个服务器并行探测；url 服务器走探测，stdio 服务器标 `disabled`（无法远程探活）。

### 1.3 MCP 工具发现（SSE 协议）

这一层是核心，分三步：

1. [readSseEndpoint](/home/seahi/workspace/dsh-cli/src/mcp.ts:142)：GET `/sse`，按 SSE 格式（`event:` / `data:`）逐块解析，等到 `event: endpoint` 拿到后续 POST 地址（`/messages?sessionId=xxx`）。
2. [mcpRpc](/home/seahi/workspace/dsh-cli/src/mcp.ts:166)：通用 JSON-RPC 往返。响应可能是纯 JSON 也可能是 `data: {...}` 的 SSE 事件，取最后一条 `data:` 解析；`error` 字段直接抛错。
3. [listServerTools](/home/seahi/workspace/dsh-cli/src/mcp.ts:197)：握手 `initialize`（id=1）→ `notifications/initialized`（id 为 null）→ `tools/list`（id=2）→ 映射成 `{server, name, description}`。

> 注意：JSON-RPC 通知（`id === null`）没有响应体，合规的 MCP SSE 服务器对 `notifications/initialized` 返回空 202。`mcpRpc` 对 `id === null` 直接跳过响应体解析（2xx 即成功），否则 `JSON.parse("")` 会抛错、工具发现整体失败。

### 1.4 缓存

[listMcpTools](/home/seahi/workspace/dsh-cli/src/mcp.ts:217) 按 `serverName` 缓存工具表 60 秒（模块级 `Map`）。斜杠菜单每次打开都会调它，没有缓存会反复握手。

## 2. 底部状态：footer.tsx

[McpStatus](/home/seahi/workspace/dsh-cli/src/components/footer.tsx:28) 从“挂载时读一次”改为：

- `onMount` 先刷一次，再 `setInterval(3000)` 轮询 `refreshMcpStatus()`；
- `alive` 标志 + `onCleanup` 清定时器，防止组件卸载后异步结果写 signal；
- 显示从两个 `<text>`（依赖 flex gap）合并成一个文本节点 `{count()} MCP /mcp`，空格硬编码，不会被挤成 `0 MCP/mcp`；`/mcp` 就是查看 MCP 列表的命令，不再指向不存在的 `/status`；
- 圆点颜色：有 failed 红色、有连接绿色、否则灰。

## 3. 斜杠菜单分类

### 3.1 命令目录：commands.ts / app.tsx

- [commands.ts](/home/seahi/workspace/dsh-cli/src/commands.ts) 的 `CommandItem.kind` 增加 `"mcp"`；`LOCAL_COMMANDS` 首位新增 `mcp` 命令。
- [app.tsx](/home/seahi/workspace/dsh-cli/src/app.tsx:164) 的 `commandItems()` 把 `mcpTools()` 映射成 `flashkey:status` 这类条目（kind `"mcp"`、behavior `"run"`），与 skills（kind `"skill"`）一起并入目录。
- 打开斜杠菜单时 [refreshMcpTools](/home/seahi/workspace/dsh-cli/src/app.tsx:190) 触发发现（有缓存，不重复握手）。
- `/flashkey:status` 走已有逻辑：`line.includes(":")` → 作为普通消息发给模型，由 harness 前置步骤处理。

### 3.2 分类标题：prompt.tsx

[prompt.tsx](/home/seahi/workspace/dsh-cli/src/components/prompt.tsx:123) 关键改动只有一行：`if (isCategoryStart)` 不再要求 `i === start`。

原因：原来分类标题只在“可见窗口起点正好落在类别边界”时渲染，短列表永远只有一个“快捷”头，看起来就像没有分类。现在每个类别起点都插标题；标题不占命令行预算（`commandCount` 只统计命令行），滚动行为不变，相关滚动测试仍在。

## 4. `/mcp` 命令

[app.tsx](/home/seahi/workspace/dsh-cli/src/app.tsx:248)：`name === "mcp"` 时调 `refreshMcpStatus()`，把每个服务器渲染成 `● flashkey connected http://...`，返回持久面板（与 `/sessions` 同类，是列表不是反馈，所以保留面板而非 toast）。

## 5. diff 渲染修复：tool-card.ts

[buildDiffText](/home/seahi/workspace/dsh-cli/src/harness/tool-card.ts:673) 原实现 `@@` 头写完整行数（如 `+1,87`），但内容被 `MAX_OUTPUT_LINES = 20`（[message-view.tsx](/home/seahi/workspace/dsh-cli/src/components/message-view.tsx:24)）截断后只输出 20 行。OpenTUI 的 diff 解析器按 87 行去找内容、撞到结尾就抛 “Hunk at line 3 contained invalid line”。

修复方式：

- 先算 `emittedOld` / `emittedNew`（受剩余行预算约束）；
- `@@` 头按实际输出数写（如 `+1,20`），保证补丁语法合法；
- 被截掉的行仍计入 `totalLines`，因此 “(67 more lines)” 提示照常显示。

## 6. 数据流总结

```
profile 的 cordis.patch.yml（bootstrap 写入）
        │  parseMcpServers / configuredMcpServers
        ▼
  McpServerConfig[]（serverName + url / command）
        │
        ├── probeServer ──► refreshMcpStatus ──► footer 每 3s 轮询 ──► "N MCP /mcp"
        │
        └── readSseEndpoint + mcpRpc（initialize/initialized/tools-list）
                │  60s 缓存
                ▼
           McpToolEntry[] ──► commandItems ──► 斜杠菜单 "MCP" 分类
```

## 7. 改动时的注意点

- MCP 工具只有服务器在跑且握手成功才出现；服务器没起时 `/mcp` 显示 `failed`，菜单没有该分类的工具。
- stdio 服务器只显示状态（`disabled`），不做工具发现——要支持需要按 `command` 拉起子进程做 stdio JSON-RPC。
- 探测/握手都带超时（1.5s / 5s）与异常兜底，任何网络失败都只影响该服务器，不阻塞 UI。
- `listMcpTools` 的缓存键是 `serverName`，改配置或服务器重启后最多等 60 秒才刷新；需要即时生效就清空模块级 `toolCache`。

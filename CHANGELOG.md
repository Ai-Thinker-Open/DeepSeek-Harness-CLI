# Changelog

## 0.4.4

### 修复：所有 host slash 命令（含 plan 模式）报 `commands/execute: args fields do not match the descriptor`

- 根因：harness 在 0.1.5-rc 系列把 `commands/execute` 的第三个参数从 `images` 改名为 **`submittedAttachments`**（同一个数组现在同时承载图片与 staged file 回执，`file` 变体为 `{ type: "file", receiptId }`），而 dsh-cli 仍固定发 `images`。Typert 网关对 args 做**严格全等校验**（`dsh-api-gateway` 的 `assertExactArguments`：多一个字段 = `unexpected`，少一个 = `missing`），于是每次调用都被拒：`missing "submittedAttachments"; unexpected "images"`。
  - 影响面是**所有** host 命令（`/model`、`/mcp`、`/image`、`/rename`、`/fork`、`/compact`…）以及 **plan 模式开关 `/plan`、`/plan off`** —— `runCommand` 只特判 `not found|404`，网关原文被当提示直接抛出，就是用户看到的红条。
- 佐证：官方 `@deepseek-ai/dsh-client-connection` 的 fixture 至今仍在读 `args.images`，说明这确实是 harness 近期改名，dsh-cli 曾经正确、只是没跟上。
- **为什么不用版本号判断**：本机 harness 的 meta 包是 `dsh 0.1.5-rc.1`，但其组件 `dsh-commands` 已是 `0.1.5-rc.2` —— `dsh --version` 分辨不出这次改名，`MIN_DSH_VERSION` 一类守卫对此无效。
- 修复：
  - `src/harness/client.ts` 的 `commandExecute()` 改发 `submittedAttachments`（其 image 变体与原有 `ImageCommandImage` 形状完全一致；数组必填，空数组也要显式发送）。
  - 新增**一次性、带缓存**的字段协商：若网关以 `gateway/arguments-invalid` 拒绝且错误文本点名了附件字段，则改用另一名字重试一次并记住结果；重试仍失败且仍是同类错误时**回滚**缓存（避免锁死猜测值）；与附件无关的参数非法**不重试**。
  - `src/harness/session.ts` 的 `runCommand` 对 `gateway/arguments-invalid` 给出可读诊断（"客户端与 harness 版本不一致"），不再把网关原文当命令错误展示。
- 顺带核对：用 harness 的 descriptor 逐个比对了 dsh-cli 调用的 **17 个 endpoint**（`wrapArgs` 包装规则 vs 各 descriptor 的必填 wire），**只有 `commands/execute` 一处漂移**，其余（含 `commands/list`、`session/list` 的 `_request`、`settings/update` 的可选 `expectedRevision`）全部匹配。
- 测试：`test/client.test.ts` 新增「协商成功并缓存」「无关错误不重试」「两个名字都失败时回滚」三个用例；既有 payload 断言同步为 `submittedAttachments`。

## 0.4.3

### 修复：`@deepseek-ai/schemastery` 锁在 3.18.1 导致 npm 全局安装失败，并产生 79 份重复副本

- 根因：`package.json` 把 `@deepseek-ai/schemastery` 精确锁在 `3.18.1`，而本包依赖的 dsh 插件（解析到 `0.1.5-rc.2`）声明的是 `^3.18.2`。
  - **npm 侧**：严格 peer 校验直接失败 —— `ERESOLVE: Could not resolve dependency: peer @deepseek-ai/schemastery@"^3.18.2" from @deepseek-ai/dsh-settings@0.1.5-rc.2`。也就是说 `npm install -g @ai-thinker/deepseek-harness-cli` 装不上；因为 bun/pnpm 对 peer 宽松，本地开发与 CI 一直没暴露这个问题。
  - **bun 侧**：bun 靠嵌套多份副本来绕过 —— 根是 `3.18.1`，另外装了 **79 份嵌套的 `schemastery@3.18.2`**。同一进程里同时存在两个 schemastery 实例（schema 校验依赖实例一致性，属隐患，同时也是体积浪费）。
- 修复：该依赖从 `3.18.1` 提升到 **`3.18.2`**，并保持本仓库对共享运行时库的**精确锁定**约定（与 `@opentui/core@0.5.9`、`@opentui/solid@0.5.9`、`solid-js@1.9.12`、`ws@8.21.3` 一致）。`3.18.2` 同时满足全树所有范围声明（`^3.18.1` ×68、`^3.18.2` ×41），因此 npm 的 peer 校验不再可能冲突。
- 效果：`bun.lock` 重新解析后 schemastery 只剩 1 条解析条目（`-129` 行），嵌套副本 **79 → 0**，全树共用一份实例；`bun install --frozen-lockfile` 报 no changes（CI 可正常通过）。
- 测试：`test/dsh-patch.test.ts` 里的精确锁定断言同步为 `3.18.2`。

## 0.4.2

### 修复：启动前拦截「dsh 版本不匹配」与「跨系统 node_modules」，给出根因而非原始堆栈

- 根因一（dsh 版本过低）：bundle 的 `cordis.patch.yml` 行引用的插件包，必须存在于**已解析 dsh 自身**的依赖闭包里（loader 用裸标识符从 dsh 自己的 `node_modules` 动态 import）。例如 `@deepseek-ai/dsh-client-file-upload` 是经 `dsh → dsh-web-app → dsh-client-file-upload` 传递进来的，0.1.2 的 dsh 两者都没有 —— 于是 loader 直接抛 `Cannot find package '@deepseek-ai/dsh-client-file-upload'`（或 `duplicate loader entry id`），把真正原因藏起来。
  - 新增 `src/dsh/dsh-version.ts`：`MIN_DSH_VERSION = "0.1.5-rc.1"`。启动时探测 `dsh --version`，低于该版本则打印明确修复命令（`npm i -g @deepseek-ai/dsh@0.1.5-rc.1`）并以 1 退出；npx 回退路径始终取最新版，跳过检查。探测失败或版本无法解析时**不拦截**启动（缺省放行）。
- 根因二（跨系统 node_modules）：OpenTUI 渲染库是按平台安装的 optionalDependency（`@opentui/core-<os>-<arch>[-musl]`）。在 Windows 装好却在 WSL 里运行（或复制了另一系统的 node_modules）时，当前平台的包并不存在，客户端会在 harness 已接管终端之后才在渲染器深处抛 `Cannot find module '@opentui/core-linux-x64'`。
  - 新增 `src/dsh/render-lib.ts`：按平台/架构列出候选包名，用 ESM 解析（`import.meta.resolve`，与客户端同解析条件、同作用域）确认其是否存在，缺失则在 spawn 客户端之前给出「node_modules 是给另一个系统装的」提示。dispatcher（直接拉起客户端）与 runner（经 profile 启动客户端）两条路径都已覆盖。
  - 有意不用 `require.resolve`：OpenTUI 平台包只导出 `bun`/`import` 条件，CJS 解析对**已安装**的包也会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，会造成误报。
- 两个检查均通过可注入的 `internals` seam 接入（便于测试），并补充单测：`test/dsh-version.test.ts`、`test/render-lib.test.ts`，以及 dispatcher/runner 的失败路径用例。

### 修复：deepseek-v4.1-flash（`deepseek-flash` / `DeepSeek-V41-Flash`）被误报「可能不支持图片」

- 根因：composer 判断图片能力用的是模型名启发式 —— 名字里必须出现 `vision`/`multimodal`/`omni`/`vl` 才认为支持图片。dsh 0.1.5 的新默认模型 `deepseek-flash`（显示名 `DeepSeek-V41-Flash`）在 `@deepseek-ai/dsh-llm-deepseek` 的 `DEFAULT_MODELS` 里声明的是 `inputModalities: ["text","image"]`，但名字里没有这些标记词，于是 dsh-cli 贴图时会误报「当前模型可能不支持图片，请切换到视觉模型」，让用户以为该模型不被支持。
- 背景：harness 并未把 `inputModalities` 暴露给 API 客户端 —— `session/modelCatalog` 每条只返回 `id`/`name`/`description`/`reasoning`；`imageLimits` 投影是附件存储的**静态**媒体类型表（不随模型变化），不是按模型的能力。因此客户端只能按 id/名字判断，这正是该判断需要集中管理的原因。
- 修复：新增 `src/harness/model.ts` 的 `modelSupportsImages()`，把判断收敛到一处 —— ①显式列出 dsh 声明支持图片的模型（比较时忽略大小写与 `-`/`.`/`_`/空格，因此 catalog id `deepseek-flash`、显示名 `DeepSeek-V41-Flash`、写法 `deepseek-v4.1-flash` 均可命中）；②保留原有的 `vision|multimodal|omni|vl` 关键字启发式。两者都不匹配仍按「不支持」处理（保持提示，最终由 harness 裁决）。`provider/model` 前缀会被忽略。
- 提示文案同步改为指向当前支持图片的模型（如 `DeepSeek-V41-Flash`）。新增单测 `test/model-capability.test.ts`，并在 `test/session.test.tsx` 增加「该模型贴图不再误报」的集成用例。

### 修复：模型显示的是原始 id（`deepseek-flash`）而不是模型名（`DeepSeek-V41-Flash`）

- 根因：harness 只在 `session/modelCatalog` 的**分组条目**里给出模型友好名（`name`），而在真正驱动界面显示的三处位置给的都是 **id**：`request/context.model`、`catalog.default.model`（即"当前模型"）、`selectModel` 的返回值。dsh-cli 直接把这些 id 原样写进 `modelName`，于是 composer 右下角显示的是 `deepseek-flash` —— 完全看不出这是 v4.1 flash 模型（模型名 `DeepSeek-V41-Flash` 里的 "V41" 才是版本信息）。`dsh-cli` 因此被感觉成"没有 deepseek-v4.1-flash 的模型显示"。
- 修复：在 `src/harness/client.ts` 里把 **id → 友好名** 的映射集中到客户端（每次读取 catalog 时记录，`modelLabel(id)` 查询，未知 id 原样返回），并在四个显示点统一应用：
  - `describe()` 的 `HostDescribe.model`（首页徽标，改动后语义为**显示名**）；
  - `request/context` 事件（会话中的徽标）；
  - `refreshModelName()`（resume/fork 后的补齐）；
  - `selectModel()`（切换模型后的即时更新）。
- `/model` 面板的「当前模型」行同样改为显示友好名（`deepseek-official/DeepSeek-V41-Flash`），与面板内 `○ DeepSeek-V41-Flash` 列表行保持一致；catalog 里查不到时回退为 id。
- `HarnessClientLike` 新增 `modelLabel(id)`，两个测试用 FakeClient 已同步实现。
- 新增单测：`test/client.test.ts`（真实 `HarnessClient` 的 catalog→显示名映射与 `describe()` 结果）、`test/harness-session.test.ts`（`request/context` 的 id 解析与未知 id 回退）。

## 0.4.1

### 修复：FlashKey 清理把 profile 补丁清空导致启动失败

- 根因：0.4.0 清理 `mcp-flashkey` 时，如果不小心把 profile 的 `cordis.patch.yml` 清成**只剩注释**，YAML 会解析为 `null` 而不是顶层数组，dsh 直接报错拒绝启动：`overlay .../profiles/tui/cordis.patch.yml must be a top-level YAML array of loader patch entries`。
- 修复：新增 `normalizeProfilePatch()` —— 移除 FlashKey 行后若补丁不再含顶层数组项，则补一个显式 `[]`，保证始终是合法顶层数组；并且**会自动修复已经被上一版清理坏的注释-only 补丁**（下次启动自愈）。
- 如果你的 profile 已经坏了、暂时起不来，可先手动修：
  `printf '\n[]\n' >> ~/.dsh/profiles/tui/cordis.patch.yml`

## 0.4.0

### 适配：升级到 DeepSeek Harness `@deepseek-ai/dsh` 0.1.5

- host 插件依赖从 `^0.1.2-rc.1` 整体升到 `^0.1.5-rc.1`（profile 内与 dsh-base 0.1.5 保持同版本线，避免错配）。
- **`system-prompt` 配置键改名**：dsh 0.1.5 把 `persona` 拆成 `personaPrefix`/`personaSuffix`（`@deepseek-ai/dsh-system-prompt`），`cordis.patch.yml` 已改用 `personaPrefix`。
- **`commands/execute` 的 `images` 需要判别字段**：0.1.5 把该数组改为 image/file 联合类型，图片必须带 `type: "image"`；`ImageCommandImage` 与命令发图路径已补上。
- 兼容性核对（0.1.2-rc.1 → 0.1.5-rc.1）已确认其余契约**未破坏**：`/api/remote.mux` 复用协议、api-gateway 的 `/api/<method>` 分发、`session/modelCatalog` 结果结构、`session/create`·`selectModel`·`credentials/*`·`settings/*`·`skills/list` 参数/结果、`connection.authenticatedUrl`/`authorizeIndex`、`webServer.register`、`appExit`/`cmdlineArgs` 服务、dsh-base 的行 id 集合（仅移除 dsh-cli 未使用的 `tool-str-replace-editor`）。
- 其余上游变更为**新增**（远端方法新增 `workspaceFiles/*`、`fileUploads/upload`、`goals/get`、`sessionFeedback/record`；`session/prompt`/`session/updateQueue` 新增 `file` 变体；`session/list` 新增 `inbox` 投影），对 dsh-cli 向后兼容。

## 0.3.20

### 修复：首页发出的第一条消息未在会话页显示

- 根因：harnes 可能在 `session/seed`（`session/follow` 首帧快照）里返回**还没持久化这条 prompt 的历史**（真实竞态），而客户端 `applySeed`/`resyncFromHistory` 用 `model = foldHistory(...)` **整体替换**模型，导致用户刚在首页发出的首条消息被快照清掉。
- 修复：`applySeed` 与 `resyncFromHistory` 替换模型前先保留本地已添加的用户消息，若快照/历史里还没有同内容的回声，则追加回去（同内容回声跳过，避免重复）。

### 修复：首页/会话模型名不一致（仍显示 DeepSeek-V4-Flash，实际是 -Vision-Exp）

- 根因：`modelName` 来自 catalog 默认值，而 catalog 刷新（`describe`/`refreshModelName`/`refreshHostModel`）会在 `request/context`/`/model` 上报真实模型后**又覆盖回默认值**。
- 修复：新增 `modelNameLive` 标记——`request/context` 或显式 `/model` 选择上报的模型为权威，之后的 catalog 刷新不再覆盖。会话运行后首页/会话徽标稳定显示实际模型。
- 说明：纯首页（未发消息、无 request/context）仍显示 catalog 默认值；若要让「启动即显示 Vision-Exp」，需 harness 的 `session/modelCatalog` 把当前模型上报为 `-Vision-Exp`（客户端侧无法推断）。

### 修复：tui profile 仍残留 FlashKey MCP 配置

- 根因：0.3.14 移除 FlashKey MCP 时只停止**写入** `mcp-flashkey`，未清理已存在 profile 的 `cordis.patch.yml` 旧行，导致 `/mcp` 仍列出已移除的服务器。
- 修复：dispatcher 启动时对 tui profile 的 `cordis.patch.yml` 做幂等清理——移除 `mcp-flashkey` 行及随之变空的 `- insert:`。

## 0.3.19

### 功能：启动时自动拉取最新 Ai-Thinker skills（节流）

- 之前：首次 `git clone --depth 1` 后就不再更新，skill 版本停留在首次克隆那一刻。现在：已克隆的 skills 仓库在启动时 `git fetch --depth 1 origin` + `git reset --hard origin/HEAD` 刷新到最新，**默认每天最多一次**（避免每次启动都联网）。
- 可用 `DSH_NO_SKILLS_UPDATE=1` 关闭自动更新；用 `DSH_SKILLS_UPDATE_INTERVAL_MS` 调整节流间隔（毫秒，默认 24h）。失败非阻塞：联网失败时继续用现有 checkout 并照常链接。
- 说明：`vendor/` 在 `.gitignore` 中且未进 git，发布包不内置 skills；真实用户走「克隆」分支，因此本功能对真实用户生效；源码/开发机若用 vendor/ 路径则不受影响（开发者手动更新 vendor）。

### 功能：重启一次直接切换到最新版本（免二次重启）

- 之前：`bin/dsh-cli` 先 `import(dispatcher)`（旧代码）再执行 `applyPendingUpdates()`（装新版本），所以版本升级要「应用一次 → 再重启一次」。
- 现在：新增独立 `dist/apply-update.js`，`bin/dsh-cli` 在 `import(dispatcher)` **之前**先运行它；应用后 import 读到的就是磁盘上的新版 `dist/dispatcher.js`，本次启动即用新版——**一次重启直接切到最新版**。
- 老版本（0.3.18 及更早）没有 apply-update.js，仍走旧的「两次重启」路径；从本版起后续更新一次重启即切换。

## 0.3.18

### 修复：首页模型名与会话实际模型不一致（显示 DeepSeek-V4-Flash，实际是 -Vision-Exp）

- 根因：`ensureSession()` 先把 harness 实际模型（`describe()` 的 `info.model`）写到徽标，随后 `resetSessionState()` 又把它重置为硬编码占位符 `DeepSeek-V4-Flash`，导致首页/会话徽标一直显示通用默认模型，直到首个 `request/context` 事件才被实际模型覆盖。
- 修复：把 `setModelName(info.model)` 移到 `resetSessionState()` 之后，让 harness 返回的实际模型覆盖占位符；新增 `refreshHostModel()`（无会话即可读 `session/modelCatalog`），启动时刷新首页徽标，使首页一开始就显示真实模型（如 `DeepSeek-V4-Flash-Vision-Exp`）。

### 修复：Windows 每次启动弹出新终端窗口

- 根因：Windows 上所有子进程经 `portableSpawnOptions`/`portableSpawnSyncOptions` 走 `shell: true`，但未设 `windowsHide`，Node 默认为每个子进程新建控制台窗口。
- 修复：这两个 helper 在 win32 上追加 `windowsHide: true`（`CREATE_NO_WINDOW`），子进程经继承的 stdio 复用启动终端，不再弹新窗口；Linux/macOS 上是 no-op。

## 0.3.17

### 修复：升级后启动页版本号仍显示旧版本

- 根因：TUI 始终运行在 tui profile 里的 bundle 副本（`~/.dsh/profiles/tui/.../dist/cli.js`），其版本号在**构建期**内联进 `dist`。`npm install -g` / 静默升级只更新全局包，profile 副本的 `dist` 可能被 pnpm 复用旧文件，导致刷新 profile 后页脚仍显示上一版（如 0.3.13）。
- 修复：启动器（dispatcher）把自身实际版本经 `DSH_CLI_VERSION` 环境变量透传给 `dsh` → runner → 客户端；页脚优先读取该值，未设置时才回退到构建期内联的 `pkg.version`。这样升级后启动页脚号始终等于启动器当前版本，不再受 profile bundle 陈旧副本影响。

### 修复：API Key 输入框 Enter / 退格键无法确认

- 根因：`api-key-modal` 除了 `<input>` 自身的 `onSubmit`（Enter）外，又叠加了一个全局 `useKeyboard` 的 Enter 处理并调用了 `key.preventDefault?.()`，会抢占输入框原生的 Enter / 退格路由；在部分终端上这让 Enter 无法提交、退格/删除无效。
- 修复：移除模态里这段多余的 Enter 全局处理，只保留 `Esc`（跳过）走 `useKeyboard`，Enter 统一交给输入框原生 `onSubmit`，与主输入框/队列编辑框的标准行为一致。退格/删除由输入框原生处理。
- 回归：新增「退格编辑后确认」与「空 Key 提示校验错误」两个用例，锁定 Enter/退格行为。

## 0.3.16

### 修复：切换模型后模型名不更新/重启回原模型

- 根因：dsh 0.1.2 的 `session/modelCatalog` 返回的当前/默认选择字段是 **`default`**（可路由 provider 是 `routableProviders`），而客户端类型与读取处用的是 **`current`**/`routable`，导致 `catalog.current` 恒为 undefined。
- 修复：客户端新增 `fetchModelCatalog()`，把服务端 `default` → 客户端 `current`、`routableProviders` → `routable`，`listModels` 与 `describe()` 统一使用。切换模型（`session/selectModel` 持久化到默认选择）后模型名能即时更新，`dsh-cli -c` 恢复时也能读到已切换的模型。

## 0.3.15

### 修复

- toast 自动消失时间从最长 6s 缩短到**最长 3s**（短消息 1.8s 起）。
- 工具结果在**折叠（回放）和实时到达**时都应用 `stripSubprocessNoise`，过滤掉 Git Bash 在 Windows 上调用 ssh 时打印的 `*** fatal error - couldn't create signal pipe` 噪音行（此前只在 composer 输入处过滤，工具结果卡片仍会显示该噪音）。

## 0.3.14

### 变更：移除 FlashKey MCP 服务器

- 从包中移除 `vendor/flashkey-mcp`（FlashKey MCP 服务器 Python 源码 + openocd 二进制，约 33MB），后续版本不再随包分发。
- `bootstrap` 不再安装/启动 FlashKey MCP SSE daemon，也不再向 tui profile 写 `mcp-flashkey` 行；`vendor/` 只保留 Ai-Thinker skills。
- 相关环境变量 `DSH_NO_FLASHKEY` / `FLASHKEY_INSTALL_URL` / `FLASHKEY_SSE_PORT` 移除。通用 MCP 客户端（`/mcp`）保留，可配置其它 MCP server。

### 功能：会话内静默升级提示

- 后台 `silent-update-agent` 暂存到新 dsh-cli 更新后，**正在运行的会话**会轮询到并在 30s 内弹出「检测到新版本 X · 重启后生效」，无需等到下次启动才提示。

## 0.3.13

### 修复：`dsh-cli -c` 恢复会话显示空屏

- `history()` 读 `session/page` 时用 `throughSeq:-1`，而宿主端 `paginate` 会把它算成 `end = throughSeq + 1 = 0` → **永远返回空页**，导致恢复会话/读历史都拿不到记录。
- 改为：识别 `session/follow` 流的**首帧 `snapshot`**（携带 `records` + `cursor` + `projections`），通过 `session/seed` 折叠进模型作为初始记录；同时给 `resyncFromHistory` 加空结果守卫，避免它用空的 `session/page` 覆盖快照 seed 的模型。
- 顺带：`resyncFromHistory` 在无记录时不再强行清空模型（空白会话的清空由 `resetSessionState` 负责）。

## 0.3.12

### 修复

- `dsh-cli -c` / `--continue` 恢复会话时，`refreshModelName` 在模型目录返回空（`session/modelCatalog` 无值或尚未就绪）时崩溃：`catalog?.current.model` 只守护了 `current`，`catalog` 为 null/undefined 时 `undefined is not an object`。改为 `catalog?.current?.model`，并同步加固 `describe()` 与模型面板里同类的 `current.model`/`current.provider` 访问，缺失时优雅降级（不设置模型名）而非崩溃。

## 0.3.11

### 修复与 dsh 0.1.2-rc.1 的兼容

- `cordis.patch.yml`：不再重复声明 dsh-base 已提供的行（`storage` / `storage-json` / `storage-domain` / `session-projection-cache`），并移除指向 `@deepseek-ai/dsh-host-apiproxy` 的 `api-gateway` 行（该包在 dsh `0.1.2-rc.1` 已移除，改由 dsh-base 的 `@deepseek-ai/dsh-api-gateway` 提供）。
- `package.json`：把 bundle 引用的 11 个 host 插件（`dsh-workspace`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-code-runtime-worker-thread`、`dsh-host-directory-picker-auto`、`dsh-host-plugin-inventory`、`dsh-cordis-host-runner`、`dsh-file-reference-local`、`dsh-message-feedback`、`dsh-session-reference`、`dsh-session-stats`）声明为 `^0.1.2-rc.1` 依赖，安装进 profile，避免启动时 `ERR_MODULE_NOT_FOUND: Cannot find module '@deepseek-ai/dsh-host-apiproxy'`。
- 启动预检改为**只读**：只检测并打印重复的 plugin id 与所在层，不再自动改动任何配置文件，避免把 YAML 改坏；`DSH_NO_PROFILE_REPAIR=1` 可跳过。

### 连接修复：迁移到 dsh 0.1.2-rc.1 的 `/api/remote.mux` 下行

- 客户端下行从旧的 `/api/events.mux`（SSE，由已删除的 `dsh-host-apiproxy` 提供）迁到 dsh `0.1.2-rc.1` 的**多路复用 `/api/remote.mux` WebSocket**（由 `dsh-api-gateway` 提供）：`eventStream` 打开该 socket、声明 `$events` / `session/follow` 逻辑流并翻译帧；RPC 改为斜杠法端点 + `payload.args`，问答/审批经 `$events/result` 应答。
- `runner`：注册 launch-token `/` 路由并下发 `DSH_AUTH_URL`，使 `/api/*` 与 `remote.mux` 握手携带签名的 `dsh-auth-*` cookie。
- **修复 `Unexpected server response: 101`**：构建时把 `ws` 保持 external（`scripts/build.ts` `external: ["@opentui/core","ws"]`）。`bun` 打包 `ws` 会替换其 `node:http` 为 shim，且该 shim 从不触发 `upgrade` 事件，导致合法 101 握手被当作普通 `response` 而报错。

### 健壮性与安全

- 调试日志全部改写到文件（`DSH_DEBUG_LOG` 或 `$TMPDIR/dsh-cli-debug-<pid>.log`，权限 `0600`），不再写 stderr，避免污染 OpenTUI 界面；并**不再记录完整 launch-token cookie**。
- `DSH_DEBUG` 值语义统一（`0/false/no/off` 视为关闭，修掉 `DSH_DEBUG=0` 反而开启调试）；`runner`/`dispatcher` 在找不到 bun 时提示 `@oven/bun-*` 可选依赖重装或手动安装。
- 客户端在收到 `401` 时重签一次 launch-token cookie 重试；拒绝通过明文 http/ws 连接**非 loopback** harness（要求 https/wss）。
- 下行断线重连改为指数退避（1.5s → 30s 封顶），并在成功收帧后复位。
- README 补充说明：Bun 以 `@oven/bun-*` 可选依赖随包分发，普通 `npm install -g` 无需单独安装 Bun。

## 0.3.10

### 启动修复：重复插件条目自动检测与修复

- 启动前先 `dsh --profile tui --dump-config` 组合 profile，检测任何重复的 loader 条目 id（例如 `storage`、`storage-json`、`storage-domain`，以及 `workspace` / `api-gateway` / `webserver` / `connection` 等宿主服务行）。
- 当更早的层（`dsh-base` / 其它 bundle）已提供同名 id 时，自动去掉本 bundle（`node_modules/@ai-thinker/deepseek-harness-cli`）里重复且冗余的那一份，保留更早层的一份，然后正常启动。修复只作用于「确实重复」的 id，旧版 `dsh-base`（不提供这些行）不受影响。
- 无法安全自动修复的重叠（例如两个 bundle 都声明同一 id）会打印「来自哪两层、怎么删」的明确提示，并以清晰错误退出，不再只甩一屏堆栈；`DSH_NO_PROFILE_REPAIR=1` 可跳过预检。
- 修复「较新的 `@deepseek-ai/dsh`（其 `dsh-base` 自带 `storage` 等宿主服务行）搭配旧版 `dsh-cli` bundle 时启动报 `duplicate loader entry id: storage`」的版本错配问题。

### 对话语言

- 默认系统提示词改为**默认使用简体中文回复**（除非用户明确要求其它语言），修复模型默认倾向英文的问题。

## 0.3.9

### 交互与安装

- 「回到最新消息」改为状态栏"Esc 取消"右侧的蓝色「↓ 回到新消息」药丸按钮：仅当向上滚动离开底部时出现，点击跳回最新并自动隐藏。
- 移除 `@deepseek-ai/dsh` 硬依赖：`npm install -g dsh-cli` 不再下载整个 harness（修复安装卡住）；dsh 改为首次启动可见提示获取、并继续由静默更新器保持更新。

## 0.3.8

### 启动可靠性与静默更新

- 启动时检测 `tui` profile 内 bundle 版本与当前安装不一致时，自动重新注册/重建 profile，让 `npm install -g` 或静默升级真实生效（此前运行时始终加载旧拷贝，装新版本仍显示旧版本）。
- 安装 dsh-cli 时顺带安装 `@deepseek-ai/dsh`（`^0.1.1-rc.2`），不再首启走 npx 静默下载。
- 后台更新代理与 `npm install -g` 在 Windows 上不再弹出终端窗口（`windowsHide`）。
- bootstrap 明确打印"正在装什么 + 命令 + 跳过方式"，避免静默下载像卡死。

## 0.3.7

### 审批与提问体验

- 权限 / ask-user / 计划审阅 / 沙箱升级审批改为**输入框上方的停靠确认栏**（不再全屏遮罩），对话与工具输出保持可见，焦点自动锁定，回车/空格/Esc 直达确认栏。
- 多问题 ask-user 批次支持**分页审阅**：`Enter` 记录并自动翻到下一题，`←/→` 回看，最后一题按 `Enter` 后出现「确认全部」，再按一次才提交，`Esc` 整批拒绝；并一次性按批次顺序提交所有答案。
- 确认卡片、目录风险、API Key 弹窗统一为深色圆角卡片风格（`backgroundCard` + 圆角边框）。

## 0.3.6

### 会话真实隔离与状态安全

- 新增统一的 `resetSessionState()`：新建/恢复/分叉会话时清空所有会话级状态（消息、统计、队列、各缓存、流式瞬时状态），杜绝会话间上下文泄漏。
- 修复恢复空白会话时旧会话消息残留、统计用「旧值优先」导致的跨会话继承；恢复/分叉后的统计改为从持久投影 + 事件推导干净重建。
- 分叉/恢复后主动刷新技能目录与模型名，避免界面显示上一会话的残留。

### 跨会话记录查询与导出

- 新增 `searchSessions` RPC 与 `/search <关键词>` 命令：跨会话全文搜索（启用 harness `session-query` SQLite FTS5 索引，`openAt: first-search`），命中可点击回链恢复会话。
- 新增 `exportSession` 与 `/export [路径]` 命令：拉取 `GET /api/session.export` 归档写本地，**默认包含 subagent/fork 子会话**；无会话时给出明确提示。
- `describeHarnessError` 识别 `SessionCwdConflict`，跨工作区恢复时给出准确的「工作区不匹配」提示而非笼统的「无法连接」。

### 并发与输入体验

- 切换会话时若旧会话仍有 turn 在后台运行，toast 提示「会话 x 仍在后台运行」，避免无感知地占用 key 配额。
- 发送历史（↑/↓ 召回）记录来源会话，跨会话召回时标注来源并警示。
- 会话日志导出、`/search`、`/export` 统一进 `/` 命令菜单。

### Think 流式与计划渲染

- Think 推理块标题改为单行 `✺ Think · <流式内容>`：取内容**最新部分**随流式滚动（解决超宽截断后开头固定、看不到新内容的问题），点击展开查看完整推理。
- `exit_plan_mode` 计划卡片自动展开并**完整渲染计划 markdown**（去除 300 字符截断），批准/执行前可完整查看。

### 静默更新与重启提示

- 静默更新仍自动执行，升级成功后客户端启动时 toast 提示「已更新 · 重启 dsh-cli 后生效」（此前用户会无感知地继续用旧版）。
- 该提示同时覆盖 `dsh-cli` 独立 CLI 与 `dsh --profile tui` 两条启动路径（后者由 runner 在拉起客户端前应用更新）；`applyPendingUpdates` 改为同步并返回实际升级清单。
- 覆盖 dsh-cli 自身与全局 harness（`@deepseek-ai/dsh`）的更新检查。

### 连接保活与独立端口

- 为 `events.mux` WebSocket 增加 10s 心跳（`ping`），避免 WSL2 localhost 转发/长闲置下静默断线，并加速断线感知。
- 看门狗改为基于 WebSocket 连接健康（`connected()`）而非「无业务帧」，消除 LLM 长思考被误判为「连接中断」的问题。
- dsh-cli / tui profile **默认端口从 3080 改为 3081**，与 web 通道（保留 3080）隔离，避免端口冲突；`--port` 仍可覆盖，端口被占自动避让。

### 补齐标准插件宿主服务

- 在 `cordis.patch.yml` 补齐 web 表面同样组合的宿主服务：`session-reference` + `file-reference-local`（`@` 引用）、`session-stats`（权威统计投影）、`message-feedback`（消息反馈）、`session-projection-cache`（投影缓存）、`plugin-inventory` + `cordis-host-runner`（插件/cordis 表面）。均为插件加载契约内的宿主行，不新增客户端依赖。

## v0.3.5 — 2026-08-30

更新改为「静默强制后台更新」：启动时不再弹出更新确认窗，改由后台在每次 `dsh-cli` 启动时静默暂存新包，下次启动自动安装并直接运行最新版。

- 移除启动时的「立即更新 / 暂不更新」提示框；dsh-cli 自身与 harness（`@deepseek-ai/dsh`）统一为同一套静默更新模型。
- **暂存**：每次 `dsh-cli` 启动时，后台拉起 `dist/silent-update-agent.js`，查询 npm registry；发现 dsh-cli / harness 有新版则下载到临时目录并写入 `~/.dsh/.updates-pending.json` 标记。本次会话继续使用当前版本，不重启、不弹窗。
- **应用**：下次启动时，`bin/dsh-cli` 在拉起 harness 前按标记逐条 `npm install -g <pkg>@<版本>`（此时尚无 TUI/渲染器，Windows 上 `opentui.dll` 的文件锁问题天然规避），成功后从标记移除；本次启动即运行最新版。
- 失败不阻塞：暂存或应用失败时静默回退当前版本、stderr 仅记一行、下个启动重试；`DSH_NO_UPDATE_CHECK=1` 仍可彻底关闭该机制。

界面细节调整：

- 移除会话底部统计行的悬停详情弹层（轮次/LLM 用时/tokens/缓存/推理），只保留精简的一行统计。
- 提示 Toast 移到右上角，改为圆角实底胶囊（成功=主题蓝、错误=红、内容自适应宽度）。
- 精简目录风险确认弹窗：移除主目录/根目录警告中「恶意插件可执行任意代码」及「勿信任整个主目录」两句，保留个人文件访问范围说明。

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

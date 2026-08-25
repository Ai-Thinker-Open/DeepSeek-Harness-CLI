# 权限确认（Permission Confirmation）功能规划

> 目标：把 harness 抛出的权限请求做成与 mimo code（MiMoCode / opencode TUI）一致的确认交互——多请求、多选、批量快捷键、一次提交；样式完全复用现有 `theme.ts` token，不新增颜色体系。

## 1. 现状与差距

### 现状

- `HarnessQuestion`（[src/session.ts](/home/seahi/workspace/dsh-cli/src/session.ts:113)）是"单问题"模型：一个 `id`、若干 `options`、一个 `kind`（`permission` / `ask-user` / `plan-approval`）。
- `QuestionModal`（[src/components/question-modal.tsx](/home/seahi/workspace/dsh-cli/src/components/question-modal.tsx:19)）渲染居中弹窗：↑↓ 选择、Enter 确认、Esc 选最后一个选项（拒绝）。
- `onQuestionRequested`（[src/harness/session.ts](/home/seahi/workspace/dsh-cli/src/harness/session.ts:728)）只取 `payload.questions[0]`，后面的请求被丢弃；`answer` 也只回传单个 `choice`。
- 协议层已经支持多选：`client.respond(rpcId, sessionId, [{ id, selected: string[] }])`（[src/harness/client.ts](/home/seahi/workspace/dsh-cli/src/harness/client.ts:235)），只是上层没用起来。
- 样式主题 `theme.ts` 本身就是 mimo code（opencode dark）同款 token：`#4D6BFE` 主色、`#0A0A0A` 背景、`#141414` 面板、`#FBBF24` 警告、`#EEEEEE` 正文、`#808080` 弱化文本。

### 差距（对照 mimo code）

| 维度 | mimo code | 当前 dsh-cli |
| --- | --- | --- |
| 请求数量 | 一个弹窗内可列多条权限请求 | 只取第一条 |
| 选择方式 | 每行 checkbox 多选 | 单选选项 |
| 批量操作 | `a` 全选 / `n` 全不选 / `i` 反选 / `l` 只选最新 | 无 |
| 确认提交 | Enter 一次提交选中的全部请求 | 一次只答一条 |
| 拒绝语义 | 明确拒绝（deny） | Esc 落到最后一个选项（语义依赖选项顺序） |
| 请求详情 | 工具 + 参数摘要（如 `Bash(ls -la)`） | 只有 question 文本 + detail |

## 2. 交互设计（对齐 mimo code）

### 弹窗结构

```
┌──────────────────────────────────────────────┐
│ 🔒 Permission  ·  3 个请求                    │  ← kindColor（warning）标题行
│                                              │
│  [x] Bash(ls -la)                            │  ← 选中行：kindColor 背景 + 反色文字
│  [x] Read(src/app.tsx)                       │
│  [ ] Edit(src/theme.ts)                      │
│                                              │
│  Space 切换 · Enter 确认 · a 全选 · n 全不选   │  ← 弱化提示行（textMuted）
│  i 反选 · l 只选最新 · Esc 拒绝               │
└──────────────────────────────────────────────┘
```

- 全屏遮罩沿用现有 `zIndex=8000` + `theme.background`，弹窗内面板 `theme.backgroundPanel`，边框 `kindColor`（permission 用 `theme.warning`，与现有弹窗一致）。
- 每行左侧 checkbox：选中 `[x]`，未选中 `[ ]`；行首 `›` 高亮跟随上下键（复用现有 QuestionModal 的选中高亮手法）。
- 底部 keybind 提示与 mimo code 同构：`Space to toggle, Enter to confirm, a select all, n select none, i invert, l toggle latest, Esc deny`，文案保留项目现有的中文风格。

### 键盘映射

| 按键 | 行为 |
| --- | --- |
| `↑` / `↓` | 移动焦点行 |
| `Space` | 切换焦点行选中态 |
| `a` | 全选 |
| `n` | 全不选 |
| `i` | 反选 |
| `l` | 只选最新一条请求 |
| `Enter` | 提交所有选中项（一次 `respond`） |
| `Esc` | 拒绝：提交空选中数组 |

键盘处理放在 `PermissionModal` 内 `useKeyboard`；弹窗打开时 app/session 层的 `useKeyboard` 已通过 `question()` 短路，无冲突。

## 3. 数据与协议设计

### 数据模型（[src/session.ts](/home/seahi/workspace/dsh-cli/src/session.ts)）

`HarnessQuestion` 保持向后兼容，扩展 permission 专用字段：

```ts
export interface PermissionRequestItem {
  id: string
  /** 展示文本，如 "Bash(ls -la)"、工具名 + 参数摘要 */
  label: string
  /** 展开详情（命令全文、文件路径等） */
  detail?: string
  /** 是否建议选中（用于默认全选 / l 只选最新） */
  suggested?: boolean
}

export interface HarnessQuestion {
  rpcId: string
  id: string
  title: string
  detail?: string
  options: string[]
  kind: "permission" | "ask-user" | "plan-approval"
  /** kind === "permission" 时使用：多条请求 */
  requests?: PermissionRequestItem[]
}
```

`ask-user` / `plan-approval` 继续走现有 `options` 单选路径，行为不变。

### 解析层（[src/harness/session.ts](/home/seahi/workspace/dsh-cli/src/harness/session.ts:706)）

- `permission` 类型：把 `payload.questions` 全部映射为 `requests`（默认全部 `suggested: true`，与 mimo 的默认全选一致）；`options` 保留 `["Allow", "Deny"]` 作为兜底。
- 其他类型：保持只取第一条、映射为单选。

### 回答层（[src/harness/session.ts](/home/seahi/workspace/dsh-cli/src/harness/session.ts:1341)）

- 新增 `answerQuestions(ids: string[])`：permission 时一次 `client.respond(rpcId, sessionId, [{ id, selected: ids }])`；多选提交即一次 RPC。
- `cancelQuestion()` 语义：permission → 提交空数组（deny）；其余 kind → 保持现有"最后一个选项"行为。
- 组件层统一暴露 `onAnswer(choice)` / `onAnswerMany(ids)`，SessionScreen 原样透传。

## 4. 组件实现

- 新增 [src/components/permission-modal.tsx](/home/seahi/workspace/dsh-cli/src/components/permission-modal.tsx)：`props.requests` + `onSubmit(ids: string[])` + `onDeny()`。
- `QuestionModal` 内按 `q.kind === "permission" && q.requests?.length` 分支，渲染 `PermissionModal` 主体；或直接把多选逻辑并入 QuestionModal 避免两个弹窗。推荐后者：一个弹窗组件、两套选项渲染，减少重复的遮罩/边框/键盘代码。
- 样式：
  - 全部颜色从 `theme.ts` 取，不新增色值（对齐 mimo code 的 token 体系）。
  - 选中行：`backgroundColor=kindColor` + 文字反色 `theme.background`（现有高亮模式）。
  - 标题行 `🔒 Permission` + 数量徽标 `· N 个请求`，`kindColor` 前景。
  - 详情行 `textMuted`、`wrapMode="char"`，沿用现有 `truncateBody` 限制。
- 键盘：参考 OpenTUI [keymap 概览](/docs/keymap/overview) 与 [keyboard 文档](/docs/core-concepts/keyboard)，用 `key.name` 判断 `"space"` / `"a"` / `"n"` / `"i"` / `"l"` / `"enter"` / `"escape"`；`isEnter`/`isUp`/`isDown` 复用 [src/components/key-match.ts](/home/seahi/workspace/dsh-cli/src/components/key-match.ts)。
- 组件文本参考 OpenTUI [Text 文档](/docs/components/text)（fg/bg/加粗）与 [Select 文档](/docs/components/select)（列表选中样式，不直接使用 Select 组件，因为需要 checkbox 多选行）。

### 可选增强（不阻塞主流程）

- 危险模式高亮：请求摘要匹配 `rm -rf`、`git push --force`、`DROP ` 等时，行内加 `theme.error` 警示标记。
- 权限预设联动：`Tab` 循环的 `read-only / workspace-write / full-access`（[src/permission.ts](/home/seahi/workspace/dsh-cli/src/permission.ts:1)）目前只是展示性切换，未影响审批策略。后续可把预设映射到 harness 的审批规则（如 read-only 下写类请求自动 deny），作为独立里程碑。

## 5. 测试与开发工具

- [test/session.test.tsx](/home/seahi/workspace/dsh-cli/test/session.test.tsx:986) 新增用例：
  - 多条权限请求渲染出 checkbox 与数量徽标；
  - Space 切换选中态、a/n/i/l 批量操作；
  - Enter 提交后 `answered` 收到完整 `selected` 数组；
  - Esc 提交空数组（拒绝）；
  - 既有 ask-user / plan-approval 单选回归不变。
- [scripts/mock-dsh-server.mjs](/home/seahi/workspace/dsh-cli/scripts/mock-dsh-server.mjs:59)：`askQuestion` 支持一次发出多条 permission 请求（prompt 带 `permission` 关键字触发），便于手动验证。
- 手动验证：`bun scripts/mock-dsh-server.mjs` + `bun run dev`，输入 `ask permission` 观察弹窗。

## 6. 实施步骤

1. 数据模型：`PermissionRequestItem` + `HarnessQuestion.requests`，解析层映射多条请求（纯逻辑 + 单测）。
2. 回答层：`answerQuestions(ids)` 一次 `respond`；Esc/deny 语义调整。
3. UI：QuestionModal 多选分支（checkbox、批量快捷键、keybind 提示行），样式全部走 `theme.ts`。
4. mock 服务器支持多条 permission，手动验证交互。
5. 补测试、更新 [README.zh.md](/home/seahi/workspace/dsh-cli/README.zh.md:19) 的"权限审批"描述（多选、批量快捷键）。

## 7. 验收标准

- 交互与 mimo code 一致：多请求列表、Space 切换、a/n/i/l 批量、Enter 一次提交、Esc 明确拒绝。
- 样式 token 全部来自 `theme.ts`，视觉与启动屏/工具卡片/现有弹窗一致，无新增色值。
- 协议层一次 `respond` 携带 `selected: string[]`，不产生多条 RPC。
- `bun test` 全绿；ask-user / plan-approval 行为无回归。

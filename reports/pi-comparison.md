# 自研 Agent 与 Pi 迁移版对比报告

评估日期：2026-09-30。基线：`7e14726d71c84693f42864f495ac2de2f692b745`；候选：`codex/pi-migration`，Pi agent-core / Pi AI 均固定 `0.85.1`。环境：macOS arm64、Node 24.18.0、pnpm 12.6.0。

## 结论

**Pi 版本已可运行，当前证据支持保留它作为实验候选，尚不足以替换主线。** 两套引擎都通过了所有固定行为场景；Pi 没有在这些场景中显示出任务质量优势，迁移后依赖量与本机启动时间有所增加。真实模型的成功率、token 消耗和总任务耗时尚未验证。

如果目标继续聚焦“小程序专用工具 + 严格审计和恢复”，自研循环仍是合理选择。如果未来维护大量模型协议、运行中追加消息或多种工具调度策略成为主要负担，Pi 更值得采用。不要因为“别人用了 Pi”或“循环代码更少”直接作决定。

## 实现边界与兼容性

| 层次       | 自研基线                               | Pi 候选                                                |
| ---------- | -------------------------------------- | ------------------------------------------------------ |
| 调度       | 本项目 `runAgent` 循环                 | Pi `Agent`；`runPiAgent` 包装生命周期                  |
| 模型       | AI SDK 7.0.122                         | Pi AI 0.85.1 的 Responses / Messages / Completions API |
| 工具与权限 | 本项目工具及执行前授权                 | 同一套工具，Pi 顺序调度；授权仍在工具执行边界          |
| 会话与恢复 | 本地 JSONL v1、锁、未完成调用检查      | 同一日志格式和恢复规则，增加可选原始 assistant 元数据  |
| 上下文     | 字符预算、截断摘要                     | 保留相同策略；额外计入 Pi 原始推理元数据体积           |
| 小程序验证 | 工程识别、配置检查、MCP、DevTools 分类 | 复用原实现，缺失的 DevTools 检查仍是 unverified        |

CLI 仍是 `weapp-agent init/run/resume/sessions/doctor/verify`，配置结构和 API key 环境变量不变。没有新增 CLI 双后端开关。`run.started.data` 增加 `engine: pi` 和 `engineVersion`；assistant 的 `message` 事件增加可选 `piMessage`，与规范消息在同一条日志中写入。旧 JSONL 可以继续使用；丢失的历史 provider 签名无法从旧会话凭空恢复。对比体验应使用不同 `WEAPP_AGENT_STATE_DIR`，避免两个版本同时操作会话。

固定 npm 版本与 Pi 主仓库最新源码有 API 差异。本版使用 0.85.1 实际提供的 `shouldStopAfterTurn`，没有依赖主仓库较新的 `finishTurn`。Pi 默认并行执行工具，本版显式设为 sequential。旧循环与 AI SDK adapter 保留为测试/对比基线，AI SDK 已从 CLI 生产依赖中移除，不随 CLI 作为第二套运行后端启用。

权限没有重写成两套。Pi `beforeToolCall` 在运行停止或先前审批拒绝时阻止后续调用；精确命令、MCP、路径与项目信任检查继续由原来的 guarded tools 执行，避免名称匹配造成重复授权或漏授权。`afterToolCall` 处理返回值脱敏和终止提示。这个安排比把所有授权条件复制到 Pi 钩子更容易维护。

## 固定场景结果

相同脚本响应、工具集、系统指令、上下文预算和初始文件，每引擎每场景 5 次，交替执行顺序。Pi 侧的脚本模型桥接仅用于测试，实际 CLI 使用 Pi AI。总计 **60/60 场景断言通过**。

| 场景                          | 自研：通过数 / 耗时中位数 | Pi：通过数 / 耗时中位数 |
| ----------------------------- | ------------------------- | ----------------------- |
| 读取 → 修改 → 强制验证        | 5/5，115.80 ms            | 5/5，136.51 ms          |
| 哈希冲突 / 保护用户改动       | 5/5，54.80 ms             | 5/5，66.21 ms           |
| 拒绝 Shell / 阻止同批后续写入 | 5/5，44.24 ms             | 5/5，60.43 ms           |
| 中断恢复 / 不重放副作用       | 5/5，59.19 ms             | 5/5，67.00 ms           |
| 上下文压缩 / 调用与结果配对   | 5/5，47.78 ms             | 5/5，57.02 ms           |
| 真实 MCP 连接关闭 / 错误传播  | 5/5，138.82 ms            | 5/5，145.36 ms          |

“通过”表示满足该场景预定断言，审批拒绝与中断停止也是正确结果；它不是自然语言开发任务成功率。时间包含临时文件、日志 fsync、部分 fixture 初始化与 MCP 启停，不是纯循环 CPU 时间。两侧都在同一测试进程加载，适合查行为差异，不适合证明生产性能优劣。样本量小，未做统计显著性分析。Mock 不产生真实 token，记录为 null，不能据此计算费用。

此外，两版构建后的 CLI 均通过同一本地 OpenAI-compatible HTTP/SSE fixture：init → 读取 → 哈希编辑 → 执行检查 → resume → sessions。每版 5 次本地请求，无收费模型调用。Pi 的正式安装包也通过了这个流程。源码级回归共 **54 项通过**，包含 22 项共享引擎契约、9 项 Pi 专项，以及原有安全、provider、工程和 MCP 测试。

Pi 专项验证覆盖：副作用之前已持久化调用；整批审批拒绝后的停止；执行中取消仍留下未决记录；日志观察者失败时不执行工具；重复 call ID 拒绝；模型输出截断时不执行不完整工具参数；原始 provider 签名恢复；推理元数据超预算时整体丢弃调用组；缓存输入 token 不重复计数。相关能力仍需真实模型和真实小程序项目继续验证。

## 工程成本和产物测量

| 指标                         |   自研 |     Pi |
| ---------------------------- | -----: | -----: |
| CLI JS 字节数                |  54838 |  60156 |
| CLI gzip 字节数              |  16450 |  17693 |
| CLI 直接生产依赖             |     12 |     10 |
| 递归生产依赖唯一包版本数     |    167 |    275 |
| 本机 --help 启动中位数（ms） | 238.63 | 355.56 |

CLI 文件大小不包含外部依赖，不能代表完整安装体积。依赖数来自 `pnpm list --prod --depth Infinity --json`，按包名和版本去重；不是安全漏洞数量。Pi AI 携带本项目暂未使用的 provider 依赖，说明多模型复用也有安装成本。本机启动数据是在其他本轮检查结束后，分别丢弃一次预热、取 5 次 `--help` 子进程启动中位数；未测内存和端到端模型延迟。

本项目引擎与 provider 的物理源代码行数：基线 509 行，Pi 活跃路径 480 行（含消息转换、共享压缩、指令和凭据映射）。基线包含约 347 行引擎与 162 行 provider；Pi 约 257 行包装运行层、81 行消息转换、87 行共享压缩/指令和 55 行 provider/凭据。格式和长行会影响该数字，它不等于认知复杂度或工时。原实现保留用于比较，因此实验分支整体代码量增加；不能把测试桥接代码当作生产简化收益。

实际迁移成本主要来自边界，而不是调用 `new Agent()`：

- Pi 内存状态与 JSONL 持久化必须由明确的权威来源协调。本版每次请求从日志构造上下文，保留已持久化的原始 assistant 元数据。
- Pi 的工具错误和 abort 语义与原系统不同。取消期间的工具不能被记录成“结果已知”，否则恢复会绕过检查。
- Pi 的批次 `terminate` 提示要求整批结果满足条件，单靠它不能保证第一次审批拒绝就停止后续操作；需要 before hook 和回合停止条件共同约束。
- 只有保留规范消息仍不够，provider 的推理/文本签名和响应标识也要恢复；原始元数据同样需要脱敏和预算控制。
- token 的 cacheRead/cacheWrite 语义不同，统计必须归一化；未知模型价格不推算费用。

Pi 承担模型协议和通用循环的上游维护，但其 API、依赖树、TypeBox/Zod 参数边界和事件语义需要本项目持续做契约测试。当前私有 providers 包的生产入口导出 `createPiModel`；原 `createModel`、`AiSdkAdapter` 保留在 `src/self.ts`，仅用于基线测试，不承诺对外兼容。

## 验证记录、限制与复现

已通过：build、lint（0 errors）、typecheck、54 项单测、安装包 smoke、两版 CLI 本地协议 smoke、60 次固定基准、repo doctor（10 pass）、repo check（无 staged 文件，实际 lint/typecheck 已另跑）。遗留 lint 提示主要为 execa 替代建议与原有函数声明顺序；没有把建议当成弃用 API 强行迁移。

环境问题：官方 npm registry 在本机返回域名不匹配的证书，固定版本安装与打包 smoke 使用 `https://registry.npmmirror.com` 重试完成，全程保留 TLS 校验。默认 registry 未修改。新增传递依赖 `@google/genai`、`protobufjs` 的安装脚本通过 pnpm 工具明确设为不执行。依赖安装还提示既有 repoctl / pnpm 工具链 peer 范围不匹配，未扩展到本实验之外升级工具链。

真实 OpenAI / Anthropic 模型：**unverified**，本会话未配置 key 和型号。真实 DevTools、小程序运行时、WebSocket、订阅 OAuth、Pi SDK 的高级自动压缩/分支会话、并行工具调度：未做此轮效果评估。本次使用的是 agent-core，不能用本报告否定或证明完整 pi-coding-agent SDK 的价值。原项目的“验证命令返回 failed 后由模型修复”行为保留；`run.completed` 本身仍不能替代外部验收。

复现离线验证（在 Pi 工作树）：

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm exec tsx scripts/compare-engines.ts
node scripts/smoke-pi-cli.mjs
node scripts/compare-live.mjs
pnpm exec repo doctor
pnpm exec repo check
```

若遇到上述 registry 环境问题：安装时显式加 `--registry=https://registry.npmmirror.com`；打包测试用 `WEAPP_AGENT_TEST_REGISTRY=https://registry.npmmirror.com pnpm test:pack`。缺少真实模型参数时 `compare-live.mjs` 输出 unverified，不冒充通过。

构建不受主目录当前修改影响的固定基线：

```bash
baseline_dir="$(mktemp -d)"
git archive 7e14726 | tar -x -C "$baseline_dir"
(cd "$baseline_dir" && pnpm install --frozen-lockfile && pnpm --filter @weapp-agent/cli... build)
node scripts/comparison-metrics.mjs "$baseline_dir"
node scripts/smoke-pi-cli.mjs "$baseline_dir/apps/cli/dist/index.mjs"
```

真实模型对比：先在当前 shell 配置 `OPENAI_API_KEY` / `WEAPP_AGENT_OPENAI_MODEL`，或 `ANTHROPIC_API_KEY` / `WEAPP_AGENT_ANTHROPIC_MODEL`，再运行：

```bash
node scripts/compare-live.mjs "$baseline_dir/apps/cli/dist/index.mjs"
```

每个已配置 provider 按同一型号、相同提示和全新隔离 fixture 对两版各跑 3 次，记录外部文件验收、验证结果、耗时、步骤、工具数、输入/输出 token 和失败分类。即使两版调用相同模型，provider SDK、请求编码、默认重试/缓存行为仍可能不同；它是完整候选方案对比，不能把差异全部归因于 Pi 循环。报告不预设赢家，下一步应先取得这些数据，再决定是否扩大到真实 Wevu/原生项目与 DevTools 任务。

原始证据：[固定场景逐次记录](pi-comparison.json)、[依赖与产物测量](pi-metrics.json)、[真实模型可用性记录](pi-live-comparison.json)。重新运行写入 `artifacts/`，本目录保留本次已审阅快照。

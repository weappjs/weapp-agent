# Weapp Agent

**从一句需求，到可验证的小程序改动。**

[文档](https://agent.weapp.dev) · [English](README.en.md) · [贡献指南](CONTRIBUTING.md)

面向微信小程序的独立 AI CLI。支持 weapp-vite 原生与 Wevu 项目，使用自己的模型和 API Key，在本机完成读取、编辑、构建、测试与开发者工具交互。

## 当前状态

源码预览版。仓库提供可运行实现和可打包 CLI，尚未发布 npm 包。实际验收记录见 [VALIDATION.md](VALIDATION.md)，模拟测试与真实模型、DevTools 验证分别记录。

## 从源码开始

需要 Node.js 24.15+、pnpm。

```bash
corepack enable
pnpm install
pnpm build
node apps/cli/dist/index.mjs --help
pnpm --filter @weappjs/agent pack --pack-destination ../../artifacts
```

将生成的 `.tgz` 安装到全局，或直接通过 `node` 调用构建入口。

在已有小程序项目中：

```bash
weapp-agent init --provider openai --model YOUR_MODEL
# 在终端环境中设置 OPENAI_API_KEY
weapp-agent doctor
weapp-agent --trust run "为首页增加一个计数器，执行构建与测试"
weapp-agent
```

新建项目：

```bash
weapp-agent init my-miniapp --create --template wevu --model YOUR_MODEL
cd my-miniapp
pnpm install
weapp-agent --trust
```

## 工作方式

- **模型独立：** OpenAI Responses、Anthropic Messages、OpenAI-compatible；支持参考截图。
- **修改可检查：** 流式进度、代码差异、文件哈希冲突检测，保留用户现有改动。
- **验证有边界：** 类型检查、构建、测试、DevTools 分别报告，缺失检查标记未验证。
- **会话可恢复：** 本地 JSONL 日志，不自动重放中断的副作用操作。
- **权限可理解：** 可信项目内编辑和已配置检查自动执行；任意 Shell、未知 MCP、上传发布需确认。
- **自动化接口：** `run --json` 输出版本化事件；`verify --json` 输出检查报告。

```bash
weapp-agent run "参考截图实现首页" --image reference.png
weapp-agent sessions
weapp-agent resume SESSION_ID "继续修复失败的检查"
weapp-agent verify --json
```

`--trust` 表示你已审阅该项目脚本与配置。工具权限控制不是 OS 沙箱。任务内容和所需源码、截图会发往配置的模型服务，会话保存在本机。不要在提示词或配置中放置密钥。

## 开发

```bash
pnpm validate
pnpm exec repo doctor
pnpm exec repo check
pnpm docs:dev
```

工程由 [repoctl](https://github.com/icelib/repoctl) 创建，文档由 [Nimbus](https://github.com/cloudflare/nimbus) 创建。核心、模型适配、小程序工具和终端界面相互分离。设计参考与固定源码版本见 [架构文档](https://agent.weapp.dev/architecture)。

## License

[MIT](LICENSE)。第三方项目的商标与许可证归各自维护者所有。

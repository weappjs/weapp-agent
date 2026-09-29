# Weapp Agent

An independent AI coding agent for WeChat mini-programs. Built for weapp-vite native and Wevu projects, with inspectable edits, local sessions and explicit verification results.

[Documentation](https://agent.weapp.dev/en/quickstart) · [中文](README.md)

## Install the preview

Download the `.tgz` from [GitHub Releases](https://github.com/weappjs/weapp-agent/releases), then run:

```sh
npm install --global weapp-agent@preview
weapp-agent --version
```

## Source preview

Requires Node.js 24.15+ and pnpm.

```bash
corepack enable
pnpm install
pnpm build
node apps/cli/dist/index.mjs --help
pnpm --filter weapp-agent pack --pack-destination ../../artifacts
```

Install the generated tarball to use `weapp-agent` globally. In a mini-program project:

```bash
weapp-agent init --provider openai --model YOUR_MODEL
# Set OPENAI_API_KEY in your terminal environment.
weapp-agent --trust run "Add a counter to the home page and verify it"
```

Supports OpenAI, Anthropic and compatible endpoints; streaming terminal conversations, reference images, tool approvals, JSON events, persistent sessions, conflict-aware editing, project verification, and stdio/HTTP MCP.

Trust permits local edits and configured checks. Arbitrary shell commands and unknown MCP operations need approval. This is not an operating-system sandbox. Source and images needed for a task are sent to your selected model provider; sessions stay local.

Use `pnpm validate` for offline checks. [VALIDATION.md](VALIDATION.md) distinguishes deterministic tests from real-provider and real-DevTools evidence.

Scaffolded with repoctl. Documentation uses Nimbus and Cloudflare Workers Static Assets. MIT licensed.

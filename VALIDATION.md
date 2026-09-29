# Preview validation

Validation performed on 2026-09-30 with Node.js 24.18.0 and pnpm 12.6.0. This is a source/packaged preview, not an npm publication.

| Check                       | Result                 | Evidence / boundary                                                                                                                            |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| repoctl bootstrap           | Passed                 | create-repoctl 1.0.5, CLI/tsdown templates; repo new; repo init                                                                                |
| repoctl doctor/check        | Passed                 | 10 doctor checks; staged check also runs at commit                                                                                             |
| Build, lint, typecheck      | Passed locally         | Five workspace packages; Nimbus lint 13 documents, Astro check 0 errors/warnings/hints                                                         |
| Deterministic tests         | Passed                 | 30 tests: tool loop, approvals, cancellation, recovery, compaction, provider streams, stdio/HTTP MCP, no Git textconv execution                |
| Standalone package          | Passed                 | Tarball installed in clean temporary project; help/init/verify work without private workspace packages                                         |
| Native + Wevu real projects | Passed                 | Official create-weapp-vite 3.0.1 templates, weapp-vite 7.4.0; add page, fail real build, repair, rebuild, check compiled route, resume session |
| Real WeChat DevTools        | Passed (native + Wevu) | One MCP connection shared across connect → reLaunch → counter tap (0 → 1) → screenshot → console log; no Web/headless substitute               |
| Native DevTools rerun       | Unverified             | Connection failed with DEVTOOLS_WS_CONNECT_ERROR; real build/repair acceptance passed, full runtime chain verified on Wevu                     |
| Nimbus browser QA           | Passed locally         | 1440px desktop, 390px mobile, no horizontal overflow, theme, navigation, search, no page errors                                                |
| Agent docs endpoints        | Passed locally         | llms.txt, llms-full.txt, Markdown page, sitemap                                                                                                |
| OpenAI real task            | Unverified             | API key and explicit live model unavailable in current environment                                                                             |
| Anthropic real task         | Unverified             | API key and explicit live model unavailable in current environment                                                                             |
| GitHub matrix / production  | Pending initial push   | CI checks Linux, macOS, Windows before deploying Static Assets                                                                                 |

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm validate
pnpm exec repo doctor
pnpm exec repo check
```

Live model validation: configure `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `WEAPP_AGENT_OPENAI_MODEL` and `WEAPP_AGENT_ANTHROPIC_MODEL`, then run `pnpm test:live`. Missing credentials produce unverified results and a failing exit code; provider-shaped mock streams are not real provider acceptance.

Create two **disposable** projects with `weapp-agent init --create --template native|wevu --model test`, install their dependencies, then set `WEAPP_AGENT_NATIVE_FIXTURE` and `WEAPP_AGENT_WEVU_FIXTURE` before running `pnpm test:fixtures`. The script adds `pages/agent-proof/index` and intentionally writes a syntax error before repairing it. Use fresh fixtures for each run.

For real runtime validation, configure a real test AppID and the `pages/agent-proof/index` launch condition in those fixtures. Log into WeChat DevTools and enable its service port. Set `WEAPP_AGENT_DEVTOOLS_FIXTURE` to one built fixture and run `pnpm test:devtools`. Run serially; the script shares one connection and uses reLaunch, then polls the rendered counter for completion. It requires screenshot and console evidence. Never run against a production business checkout. If using a system proxy, bypass localhost for the DevTools WebSocket. Reuse an existing project session where possible: forcing a fresh launch of an already open fixture produced DEVTOOLS_WS_CONNECT_ERROR; default connection reuse resolved it.

Reports and screenshots are generated under ignored `artifacts/`. No API keys, local session journals or developer credentials are committed.

## Known limits

- Real paid-model end-to-end acceptance remains open until keys and model names are available.
- Permissions are application checks, not an OS sandbox. Approved scripts run as the current OS user.
- Context compaction uses bounded excerpts, not a second model call; oversized call/result groups are summarized together and require rereading files.
- Dynamic Vite configuration is inferred rather than executed; inspect `project_info` and its warnings.
- Native fixture has no typecheck/test scripts; these categories remain unverified. Wevu's provided typecheck passed.
- ESLint emits advisory execa replacement warnings; execa is retained for cancellation and cross-platform process behavior. Astro emits dependency bundling directive warnings; build, typecheck and browser checks passed.

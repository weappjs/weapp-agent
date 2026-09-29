# Weapp Agent

Independent AI coding agent for WeChat mini-programs using weapp-vite and Wevu.

Requires Node.js 24.15+. Install the preview package from npm:

```sh
npm install --global @weapp-agent/cli@preview
```

```sh
npm install --global ./weapp-agent-cli-0.1.0-preview.1.tgz
weapp-agent init --provider openai --model YOUR_MODEL
weapp-agent doctor
weapp-agent --trust run "Add a counter and verify the project"
```

Set your provider API key in the environment. Project configuration never stores keys.

[Documentation](https://agent.weapp.dev) · [English quickstart](https://agent.weapp.dev/en/quickstart) · [Source and validation](https://github.com/weappjs/weapp-agent)

MIT. Tool permissions are not an operating-system sandbox.

import type { MonorepoConfig } from 'repoctl'
import { createMonorepoLintStagedConfig } from 'repoctl/tooling'

export default {
  commands: {
    create: {
      defaultTemplate: 'tsdown',
      renameJson: false,
    },
    clean: {
      autoConfirm: false,
      includePrivate: true,
    },
    upgrade: {
      skipOverwrite: false,
      mergeTargets: true,
    },
  },
  tooling: {
    husky: {
      // repoctl 5.5.8 spawns pnpm without Windows .cmd resolution. Invoke Node
      // entrypoints through its supported hook configuration instead.
      preCommitCommand: 'node node_modules/lint-staged/bin/lint-staged.js',
      commitMsgCommand: 'node node_modules/@commitlint/cli/cli.js --edit "{editFile}"',
    },
    commitlint: {
      extends: ['@commitlint/config-conventional'],
    },
    eslint: {
      astro: true,
      rules: { curly: ['error', 'all'] },
      ignores: ['**/fixtures/**', 'apps/docs/**', 'artifacts/**'],
      svelte: false,
      vue: false,
    },
    stylelint: {
      rules: {
        'media-feature-range-notation': 'prefix',
      },
    },
    lintStaged: {
      config: {
        ...createMonorepoLintStagedConfig(),
        // lint-staged resolves package-manager shims on Windows. Run all five
        // workspace checks without repoctl's nested spawnSync('pnpm') call.
        '*.{ts,tsx,mts,cts,vue,json}': () => 'pnpm typecheck',
      },
    },
    vitest: {
      includeWorkspaceRootConfig: false,
      coverageExclude: ['**/dist/**'],
      coverageSkipFull: true,
    },
    vitestProject: {
      globals: true,
      testTimeout: 60_000,
    },
  },
} satisfies MonorepoConfig

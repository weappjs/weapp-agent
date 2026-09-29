import type { MonorepoConfig } from 'repoctl'

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
      monorepoCommand: 'pnpm exec repo',
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

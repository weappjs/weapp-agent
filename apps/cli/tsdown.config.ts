import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: false, clean: true, target: 'node24', deps: { alwaysBundle: [/^@weappjs\//] }, banner: '#!/usr/bin/env node' })

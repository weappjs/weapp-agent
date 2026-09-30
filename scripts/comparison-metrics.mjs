import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { execa } from 'execa'

if (!process.argv[2]) {
  throw new Error('Pass the installed and built 7e14726 baseline directory')
}
const results = {}
for (const [name, root, sources] of [
  ['self', path.resolve(process.argv[2]), ['packages/core/src/engine.ts', 'packages/providers/src/index.ts']],
  ['pi', process.cwd(), ['packages/core/src/pi-engine.ts', 'packages/core/src/pi-messages.ts', 'packages/core/src/context.ts', 'packages/core/src/instructions.ts', 'packages/providers/src/pi.ts', 'packages/providers/src/credentials.ts']],
]) {
  const cli = await readFile(path.join(root, 'apps/cli/dist/index.mjs'))
  const { stdout } = await execa('pnpm', ['--filter', '@weapp-agent/cli', 'list', '--prod', '--depth', 'Infinity', '--json'], { cwd: root, maxBuffer: 10_000_000 })
  const dependencyTree = JSON.parse(stdout)[0]
  const versions = new Set()
  function visit(tree) {
    for (const [pkg, value] of Object.entries(tree.dependencies ?? {})) {
      versions.add(`${pkg}@${value.version}`)
      visit(value)
    }
  }
  visit(dependencyTree)
  const sourceLines = {}
  for (const file of sources) {
    sourceLines[file] = (await readFile(path.join(root, file), 'utf8')).trimEnd().split('\n').length
  }
  const timings = []
  for (let i = 0; i < 6; i++) {
    const started = performance.now()
    await execa(process.execPath, [path.join(root, 'apps/cli/dist/index.mjs'), '--help'])
    if (i > 0) {
      timings.push(Math.round((performance.now() - started) * 100) / 100)
    }
  }
  results[name] = { cliBytes: cli.length, cliGzipBytes: gzipSync(cli).length, directProductionDependencies: Object.keys(dependencyTree.dependencies).length, uniqueProductionPackageVersions: versions.size, sourceLines, helpProcessMs: timings, helpProcessMedianMs: [...timings].sort((a, b) => a - b)[2] }
}
const report = { baseline: '7e14726', node: process.version, platform: `${process.platform}/${process.arch}`, note: 'CLI bytes exclude external dependencies. LOC is physical source lines, not complexity. Help timing is 5 warm filesystem launches after one discarded launch; no model calls.', results }
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/pi-metrics.json', `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))

import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'

const root = path.resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(path.join(tmpdir(), 'weapp-pack-'))
const artifacts = path.join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })
try {
  await execa(
    'pnpm',
    ['--filter', '@weappjs/agent', 'pack', '--pack-destination', artifacts],
    { cwd: root },
  )
  const cliPackage = JSON.parse(await readFile(path.join(root, 'apps/cli/package.json'), 'utf8'))
  const archive = `weappjs-agent-${cliPackage.version}.tgz`
  assert((await readdir(artifacts)).includes(archive))
  assert(archive, 'Package archive exists')
  await writeFile(
    path.join(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  )
  await execa(
    'pnpm',
    ['add', '--ignore-scripts', path.join(artifacts, archive)],
    { cwd: temporary, timeout: 180_000 },
  )
  const cli = path.join(
    temporary,
    'node_modules/@weappjs/agent/dist/index.mjs',
  )
  const { stdout: help } = await execa(process.execPath, [cli, '--help'])
  for (const command of ['run', 'resume', 'doctor', 'verify']) {
    assert(help.includes(command))
  }
  const project = path.join(temporary, 'project')
  await mkdir(project)
  await writeFile(
    path.join(project, 'package.json'),
    JSON.stringify({ scripts: { build: 'node -e "console.log(42)"' } }),
  )
  const env = {
    ...process.env,
    WEAPP_AGENT_STATE_DIR: path.join(temporary, 'state'),
  }
  await execa(
    process.execPath,
    [cli, '-C', project, 'init', '--model', 'mock', '--json'],
    { env },
  )
  const { stdout: result } = await execa(
    process.execPath,
    [cli, '-C', project, '--trust', 'verify', '--json'],
    { env },
  )
  const report = JSON.parse(result)
  assert.equal(report.passed, true)
  assert.equal(
    report.checks.find(check => check.kind === 'devtools').status,
    'unverified',
  )
  const manifest = JSON.parse(
    await readFile(
      path.join(temporary, 'node_modules/@weappjs/agent/package.json'),
      'utf8',
    ),
  )
  assert(
    !Object.keys(manifest.dependencies).some(name =>
      name.startsWith('@weappjs/'),
    ),
    'Private workspace packages are bundled',
  )
  console.log(
    'PASS: standalone tarball install, help, init, trusted verify, and unverified DevTools reporting',
  )
}
finally {
  await rm(temporary, { recursive: true, force: true })
}

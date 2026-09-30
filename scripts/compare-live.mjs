import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'
// Pass the built baseline CLI explicitly; never silently compare Pi with itself.
const baseline = process.argv[2] ? path.resolve(process.argv[2]) : undefined
const candidate = path.resolve('apps/cli/dist/index.mjs')
const results = []
for (const provider of ['openai', 'anthropic']) {
  const key = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
  const model = process.env[`WEAPP_AGENT_${provider.toUpperCase()}_MODEL`]
  if (!baseline || baseline === candidate || !process.env[key] || !model) {
    results.push({ provider, status: 'unverified', reason: `Requires a separate baseline CLI argument, ${key} and WEAPP_AGENT_${provider.toUpperCase()}_MODEL` })
    continue
  }
  for (let repetition = 1; repetition <= 3; repetition++) {
    const variants = repetition % 2 ? [['self', baseline], ['pi', candidate]] : [['pi', candidate], ['self', baseline]]
    for (const [engine, cli] of variants) {
      const root = await mkdtemp(path.join(tmpdir(), 'weapp-live-compare-'))
      const started = performance.now()
      try {
        await writeFile(path.join(root, 'page.js'), '// user customization\nexport const count = 0\n')
        await writeFile(path.join(root, 'project.config.json'), JSON.stringify({ appid: 'touristappid' }))
        await writeFile(path.join(root, 'weapp-agent.config.json'), JSON.stringify({ version: 1, model: { provider, name: model }, maxSteps: 12, timeoutMs: 180000, verification: [{ kind: 'test', command: process.execPath, args: ['-e', 'const s=require("fs").readFileSync("page.js","utf8");if(!s.includes("count = 1")||!s.includes("// user customization"))process.exit(1)'] }] }))
        const run = await execa(process.execPath, [cli, '-C', root, '--trust', 'run', 'Change count from 0 to 1 in page.js using read_file and edit_file, preserve user customization, then verify_project. Do not use shell.', '--json'], { reject: false, timeout: 200000, env: { ...process.env, WEAPP_AGENT_STATE_DIR: path.join(root, 'state') } })
        const events = run.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        const verified = events.some(e => e.type === 'tool.completed' && e.data.name === 'verify_project' && e.data.result?.data?.passed)
        const source = await readFile(path.join(root, 'page.js'), 'utf8')
        const usage = events.filter(e => e.type === 'usage')
        results.push({ engine, provider, model, repetition, status: run.exitCode === 0 && verified && source.includes('count = 1') && source.includes('// user customization') ? 'passed' : 'failed', durationMs: Math.round(performance.now() - started), modelSteps: events.filter(e => e.type === 'step.started').length, toolCalls: events.filter(e => e.type === 'tool.started').length, verified, inputTokens: usage.length ? usage.reduce((sum, e) => sum + e.data.inputTokens, 0) : null, outputTokens: usage.length ? usage.reduce((sum, e) => sum + e.data.outputTokens, 0) : null, failureType: run.exitCode === 0 ? (verified ? null : 'acceptance') : events.at(-1)?.data?.status ?? 'process', devtools: 'unverified' })
      }
      catch (error) {
        // Never persist raw provider/command exceptions (they may contain credentials).
        results.push({ engine, provider, model, repetition, status: 'failed', failureType: error?.timedOut ? 'timeout' : 'process-or-protocol', durationMs: Math.round(performance.now() - started) })
      }
      finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  }
}
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/pi-live-comparison.json', `${JSON.stringify({ baseline, candidate, results }, null, 2)}\n`)
console.log(JSON.stringify(results, null, 2))
if (results.some(r => r.status === 'failed')) {
  process.exitCode = 1
}

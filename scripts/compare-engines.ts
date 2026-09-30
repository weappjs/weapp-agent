import type { ModelAdapter, ModelChunk, RunOptions, SessionEvent, Tool } from '../packages/core/src/index.js'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { configSchema, fileTools, hash, runAgent, runPiAgent, Session } from '../packages/core/src/index.js'
import { scriptedPiModel } from '../packages/core/test/pi-model.js'
import { connectMcp } from '../packages/mini-program/src/mcp.js'

const config = configSchema.parse({ model: { provider: 'openai', name: 'scripted' }, contextCharacters: 8000, maxSteps: 12 })
const call = (id: string, name: string, input: unknown): ModelChunk => ({ type: 'call', call: { id, name, input } })
const done: ModelChunk[] = [{ type: 'text', text: 'Done' }]
function scripted(steps: ModelChunk[][]): ModelAdapter {
  return { id: 'scripted', async* stream() {
    yield* steps.shift() ?? done
  } }
}
const tasks = ['read-edit-verify', 'hash-conflict', 'approval-denied', 'interrupted-resume', 'context-compaction', 'mcp-failure'] as const
const results: Record<string, unknown>[] = []
const repetitions = 5
for (let repetition = 0; repetition < repetitions; repetition++) {
  for (const task of tasks) {
    for (const engine of repetition % 2 ? ['pi', 'self'] : ['self', 'pi']) {
      const root = await mkdtemp(path.join(tmpdir(), 'weapp-compare-'))
      process.env.WEAPP_AGENT_STATE_DIR = path.join(root, 'state')
      const events: SessionEvent[] = []
      const started = performance.now()
      let connection: Awaited<ReturnType<typeof connectMcp>> | undefined
      let failure: string | undefined
      const execute = (model: ModelAdapter, overrides: Partial<RunOptions> = {}) => {
        const options: RunOptions = { root, config, model, tools: fileTools(), trusted: true, prompt: task, onEvent: (event) => {
          events.push(event)
        }, ...overrides }
        return engine === 'self' ? runAgent(options) : runPiAgent({ ...options, model: scriptedPiModel(options.model) })
      }
      try {
        if (task === 'read-edit-verify') {
          const source = '// user customization\ncount: 0\n'
          await writeFile(path.join(root, 'page.ts'), source)
          const verify: Tool = { name: 'verify_project', description: 'fixture acceptance', schema: fileTools().find(t => t.name === 'git_diff')!.schema, mutates: true, async execute() {
            assert.equal(await readFile(path.join(root, 'page.ts'), 'utf8'), source.replace('count: 0', 'count: 1'))
            return { text: 'passed', data: { passed: true } }
          } }
          const result = await execute(scripted([[call('r', 'read_file', { path: 'page.ts' })], [call('e', 'edit_file', { path: 'page.ts', expectedHash: hash(source), oldText: 'count: 0', newText: 'count: 1' })], done, [call('v', 'verify_project', {})], done]), { tools: [...fileTools(), verify] })
          assert.equal(result.status, 'completed')
          assert(events.some(e => e.type === 'tool.completed' && e.data.name === 'verify_project' && !e.data.error))
        }
        if (task === 'hash-conflict') {
          await writeFile(path.join(root, 'page.ts'), 'user changed')
          const result = await execute(scripted([[call('e', 'edit_file', { path: 'page.ts', expectedHash: hash('old'), oldText: 'old', newText: 'overwrite' })], done]))
          assert.equal(result.status, 'completed')
          assert.equal(await readFile(path.join(root, 'page.ts'), 'utf8'), 'user changed')
          assert(events.some(e => e.type === 'tool.completed' && e.data.error))
        }
        if (task === 'approval-denied') {
          const result = await execute(scripted([[call('s', 'shell', { command: 'touch denied' }), call('w', 'create_file', { path: 'skipped', content: 'bad' })]]))
          assert.equal(result.status, 'action_required')
          await assert.rejects(readFile(path.join(root, 'denied')))
          await assert.rejects(readFile(path.join(root, 'skipped')))
        }
        if (task === 'interrupted-resume') {
          const session = new Session(root)
          await session.open()
          await session.append('message', { message: { role: 'assistant', text: '', calls: [{ id: 'pending', name: 'shell', input: { command: 'touch duplicate' } }] } })
          await session.append('tool.started', { callId: 'pending', name: 'shell', mutates: true })
          await session.close()
          assert.equal((await execute(scripted([]), { sessionId: session.id })).status, 'action_required')
          assert.equal((await execute(scripted([done]), { sessionId: session.id, acknowledgeInterrupted: true })).status, 'completed')
          await assert.rejects(readFile(path.join(root, 'duplicate')))
        }
        if (task === 'context-compaction') {
          const session = new Session(root)
          await session.open()
          await session.append('message', { message: { role: 'user', text: 'old '.repeat(10000) } })
          await session.append('message', { message: { role: 'assistant', text: '', calls: [{ id: 'a', name: 'read_file', input: { path: 'page.ts' } }] } })
          await session.append('message', { message: { role: 'tool', name: 'read_file', callId: 'a', result: { text: 'past result' } } })
          await session.close()
          const model: ModelAdapter = { id: 'scripted', async* stream(request) {
            assert(JSON.stringify(request.messages).length <= 8000)
            assert(JSON.stringify(request.messages).includes('Latest goal'))
            const ids = request.messages.flatMap(m => m.role === 'assistant' ? (m.calls ?? []).map(c => c.id) : [])
            assert(request.messages.every(m => m.role !== 'tool' || ids.includes(m.callId)))
            yield* done
          } }
          assert.equal((await execute(model, { sessionId: session.id, prompt: 'Latest goal' })).status, 'completed')
          assert(events.some(e => e.type === 'context.compacted'))
        }
        if (task === 'mcp-failure') {
          connection = await connectMcp({ name: 'fixture', transport: 'stdio', command: process.execPath, args: [path.resolve('packages/mini-program/test/fixtures/server.mjs')] }, { root, trusted: true, approve: async () => true, signal: new AbortController().signal })
          await connection.close()
          let step = 0
          const model: ModelAdapter = { id: 'scripted', async* stream(request) {
            if (step++ === 0) {
              yield call('m', 'fixture__echo', { text: 'hello' })
            }
            else {
              assert(request.messages.some(m => m.role === 'tool' && m.error))
              yield* done
            }
          } }
          assert.equal((await execute(model, { tools: connection.tools, approve: async () => true })).status, 'completed')
          assert(events.some(e => e.type === 'tool.completed' && e.data.error))
        }
      }
      catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      finally {
        const durationMs = Math.round((performance.now() - started) * 100) / 100
        await connection?.close()
        results.push({ engine, task, repetition: repetition + 1, status: failure ? 'failed' : 'passed', durationMs, modelSteps: events.filter(e => e.type === 'step.started').length, toolCalls: events.filter(e => e.type === 'tool.started').length, toolErrors: events.filter(e => e.type === 'tool.completed' && e.data.error).length, verifications: events.filter(e => e.type === 'tool.completed' && e.data.name === 'verify_project').length, inputTokens: null, outputTokens: null, failure })
        await rm(root, { recursive: true, force: true })
        delete process.env.WEAPP_AGENT_STATE_DIR
      }
    }
  }
}
await mkdir('artifacts', { recursive: true })
const output = { baseline: '7e14726', piVersion: '0.85.1', node: process.version, platform: `${process.platform}/${process.arch}`, repetitions, mode: 'scripted responses; token/cost/quality claims unavailable', results }
await writeFile('artifacts/pi-comparison.json', `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({ passed: results.filter(r => r.status === 'passed').length, total: results.length, failures: results.filter(r => r.status !== 'passed'), artifact: 'artifacts/pi-comparison.json' }, null, 2))
if (results.some(r => r.status !== 'passed')) {
  process.exitCode = 1
}

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'

const cli = path.resolve(process.argv[2] ?? 'apps/cli/dist/index.mjs')
const root = await mkdtemp(path.join(tmpdir(), 'weapp-pi-cli-'))
let requests = 0
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString())
  requests++
  const previous = body.messages.filter(m => m.role === 'tool')
  const review = body.messages.at(-1)?.content === 'Review only'
  let name
  let args
  if (!review && previous.length === 0) {
    name = 'read_file'
    args = { path: 'page.js' }
  }
  else if (!review && previous.length === 1) {
    name = 'edit_file'
    const metadata = JSON.parse(previous[0].content.split('\n').at(-1))
    args = { path: 'page.js', expectedHash: metadata.hash, oldText: 'count = 0', newText: 'count = 1' }
  }
  else if (!review && previous.length === 2) {
    name = 'verify_project'
    args = {}
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const send = choices => response.write(`data: ${JSON.stringify({ id: `chat-${requests}`, object: 'chat.completion.chunk', created: 0, model: 'fixture', choices })}\n\n`)
  send([{ index: 0, delta: { role: 'assistant', ...(name ? { tool_calls: [{ index: 0, id: `call-${requests}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: 'Updated and verified.' }) }, finish_reason: null }])
  send([{ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' }])
  response.end('data: [DONE]\n\n')
})
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/v1`
  await writeFile(path.join(root, 'page.js'), '// user customization\nexport const count = 0\n')
  await writeFile(path.join(root, 'app.json'), JSON.stringify({ pages: ['pages/index'] }))
  await writeFile(path.join(root, 'project.config.json'), JSON.stringify({ appid: 'touristappid' }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "if(!require(\'fs\').readFileSync(\'page.js\',\'utf8\').includes(\'count = 1\'))process.exit(1)"' } }))
  const env = { ...process.env, OPENAI_API_KEY: 'local-fixture-key', WEAPP_AGENT_STATE_DIR: path.join(root, 'state') }
  const run = args => execa(process.execPath, [cli, '-C', root, ...args], { env, timeout: 30000 })
  await run(['init', '--provider', 'openai-compatible', '--model', 'fixture', '--base-url', url, '--json'])
  const { stdout } = await run(['--trust', 'run', 'Change count to 1 and verify', '--json'])
  const events = stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(events.at(-1).data.status, 'completed')
  assert(events.some(e => e.type === 'tool.completed' && e.data.name === 'verify_project' && e.data.result.data.passed))
  assert((await readFile(path.join(root, 'page.js'), 'utf8')).includes('// user customization\nexport const count = 1'))
  const session = events[0].sessionId
  const resumed = (await run(['resume', session, 'Review only', '--json'])).stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(resumed.at(-1).data.status, 'completed')
  assert(!resumed.some(e => e.type === 'tool.started'))
  assert.equal(requests, 5)
  assert(JSON.parse((await run(['sessions', '--json'])).stdout).includes(session))
  const verification = JSON.parse((await run(['verify', '--json'])).stdout)
  assert.equal(verification.passed, true)
  assert.equal(verification.checks.find(c => c.kind === 'devtools').status, 'unverified')
  console.log('PASS: local HTTP/SSE → CLI init/run/read/edit/verify/resume/sessions; 5 local model requests, no paid API')
}
finally {
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}

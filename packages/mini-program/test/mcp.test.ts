import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import process from 'node:process'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { configSchema, projectFingerprint } from '@weappjs/core'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { connectMcp } from '../src/index.js'

it('discovers stdio tools, validates input, and does not trust third-party readOnly annotations', async () => {
  const root = process.cwd()
  const config = configSchema.parse({
    model: { provider: 'openai', name: 'test' },
  })
  const context = {
    root,
    trusted: true,
    signal: new AbortController().signal,
    approve: async () => false,
  }
  const connection = await connectMcp(
    {
      name: 'fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [new URL('./fixtures/server.mjs', import.meta.url).pathname],
    },
    context,
    { config, fingerprint: await projectFingerprint(root, config) },
  )
  try {
    const tool = connection.tools[0]!
    expect(tool.name).toBe('fixture__echo')
    await expect(tool.execute({ text: 'hello' }, context)).rejects.toThrow(
      'Approval required',
    )
    await expect(
      tool.execute({ text: 2 }, { ...context, approve: async () => true }),
    ).rejects.toThrow()
    expect(
      (
        await tool.execute(
          { text: 'hello' },
          { ...context, approve: async () => true },
        )
      ).text,
    ).toBe('hello')
  }
  finally {
    await connection.close()
  }
})
it('discovers and calls tools over Streamable HTTP', async () => {
  const server = createServer(async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const mcp = new McpServer({ name: 'http-test', version: '1' })
    mcp.registerTool(
      'sum',
      { inputSchema: { a: z.number(), b: z.number() } },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: String(a + b) }],
      }),
    )
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = {
    root: process.cwd(),
    trusted: false,
    signal: new AbortController().signal,
    approve: async () => true,
  }
  try {
    const connection = await connectMcp(
      {
        name: 'http',
        transport: 'http',
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
      },
      context,
    )
    try {
      expect(
        (await connection.tools[0]!.execute({ a: 2, b: 3 }, context)).text,
      ).toBe('5')
    }
    finally {
      await connection.close()
    }
  }
  finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

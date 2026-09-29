import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
const server = new McpServer({ name: 'test', version: '1' })
server.registerTool('echo', { inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, async ({ text }) => ({ content: [{ type: 'text', text }] }))
await server.connect(new StdioServerTransport())

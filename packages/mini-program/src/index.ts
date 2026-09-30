import type {
  AgentConfig,
  ProjectAdapter,
  ProjectInfo,
  Tool,
} from '@weapp-agent/core'
import path from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { detectProject, exists, projectInstructions } from './project.js'

export * from './mcp.js'
export * from './project.js'
export * from './verify.js'

export class WeappProjectAdapter implements ProjectAdapter {
  detect = detectProject
  instructions = projectInstructions
  async tools(project: ProjectInfo): Promise<Tool[]> {
    return [
      {
        name: 'project_info',
        description:
          'Inspect the current mini-program project structure, scripts and framework. Re-check after changing project configuration.',
        schema: z.strictObject({}),
        mutates: false,
        async execute() {
          return {
            text: JSON.stringify(await detectProject(project.root), null, 2),
          }
        },
      },
    ]
  }
}
export async function builtinMcp(
  root: string,
): Promise<AgentConfig['mcp'][number] | undefined> {
  const bin = path.join(root, 'node_modules/weapp-vite/bin/weapp-vite.js')
  if (!(await exists(bin))) {
    return undefined
  }
  return {
    name: 'weapp',
    transport: 'stdio',
    command: process.execPath,
    args: [bin, 'mcp', '--workspace-root', root],
  }
}

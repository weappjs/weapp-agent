import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { z } from 'zod'

export const verificationSchema = z
  .object({
    kind: z.enum(['typecheck', 'build', 'test', 'devtools']),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    timeoutMs: z.number().int().positive().max(1_800_000).default(120_000),
  })
  .strict()
export const mcpSchema = z.discriminatedUnion('transport', [
  z
    .object({
      name: z.string().regex(/^[\w-]+$/),
      transport: z.literal('stdio'),
      command: z.string(),
      args: z.array(z.string()).default([]),
    })
    .strict(),
  z
    .object({
      name: z.string().regex(/^[\w-]+$/),
      transport: z.literal('http'),
      url: z.string().url(),
      tokenEnv: z.string().optional(),
    })
    .strict(),
])
export const configSchema = z
  .object({
    version: z.literal(1).default(1),
    model: z
      .object({
        provider: z.enum(['openai', 'anthropic', 'openai-compatible']),
        name: z.string().min(1),
        baseURL: z.string().url().optional(),
        apiKeyEnv: z
          .string()
          .regex(/^[A-Z_][A-Z0-9_]*$/)
          .optional(),
      })
      .strict(),
    maxSteps: z.number().int().min(1).max(500).default(40),
    timeoutMs: z.number().int().positive().default(600_000),
    contextCharacters: z.number().int().min(8000).default(100_000),
    verification: z.array(verificationSchema).default([]),
    mcp: z.array(mcpSchema).default([]),
  })
  .strict()
export type AgentConfig = z.infer<typeof configSchema>
export type VerificationCommand = z.infer<typeof verificationSchema>
export type McpConfig = z.infer<typeof mcpSchema>
export const configFilename = 'weapp-agent.config.json'
export async function loadConfig(root: string): Promise<AgentConfig> {
  let raw: string
  try {
    raw = await readFile(path.join(root, configFilename), 'utf8')
  }
  catch {
    throw new Error(
      `Missing ${configFilename}. Run weapp-agent init --provider openai --model <model>.`,
    )
  }
  return configSchema.parse(JSON.parse(raw))
}
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
export function stateRoot(): string {
  return path.resolve(
    process.env.WEAPP_AGENT_STATE_DIR
    ?? path.join(homedir(), '.local', 'state', 'weapp-agent'),
  )
}
export async function projectFingerprint(
  root: string,
  config: AgentConfig,
): Promise<string> {
  let pkg = ''
  try {
    pkg = await readFile(path.join(root, 'package.json'), 'utf8')
  }
  catch {
    /* Native projects may have no package.json. */
  }
  let diskConfig = ''
  try {
    diskConfig = await readFile(path.join(root, configFilename), 'utf8')
  }
  catch {
    /* Programmatic callers may supply configuration without a file. */
  }
  return hash(JSON.stringify({ root, config, pkg, diskConfig }))
}
export async function isTrusted(
  root: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    const trust = JSON.parse(
      await readFile(
        path.join(stateRoot(), 'trust', `${hash(root)}.json`),
        'utf8',
      ),
    )
    return trust.fingerprint === fingerprint
  }
  catch {
    return false
  }
}
export async function trustProject(
  root: string,
  fingerprint: string,
): Promise<void> {
  const dir = path.join(stateRoot(), 'trust')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(dir, `${hash(root)}.json`),
    JSON.stringify({ root, fingerprint }),
    { mode: 0o600 },
  )
}

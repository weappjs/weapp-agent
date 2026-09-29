import type {
  AgentConfig,
  Tool,
  ToolContext,
  VerificationCommand,
} from '@weapp-agent/core'
import {
  authorize,
  bounded,
  projectFingerprint,
  requireTrust,
} from '@weapp-agent/core'
import { execa } from 'execa'
import { z } from 'zod'

export interface CheckResult {
  kind: VerificationCommand['kind']
  status: 'passed' | 'failed' | 'unverified'
  command?: string
  exitCode?: number
  output: string
}
export interface VerificationReport {
  passed: boolean
  checks: CheckResult[]
}
export async function verifyProject(
  config: AgentConfig,
  context: ToolContext,
  originalFingerprint: string,
): Promise<VerificationReport> {
  await requireTrust(context)
  const checks: CheckResult[] = []
  for (const command of config.verification) {
    context.signal.throwIfAborted()
    const current = await projectFingerprint(context.root, config)
    if (
      current !== originalFingerprint
      || /publish|upload|deploy/i.test(
        [command.command, ...command.args].join(' '),
      )
    ) {
      await authorize(
        context,
        'command',
        `Verify: ${command.command} ${command.args.join(' ')}`,
        { command, fingerprint: current },
      )
    }
    const result = await execa(command.command, command.args, {
      cwd: context.root,
      cancelSignal: context.signal,
      timeout: command.timeoutMs,
      forceKillAfterDelay: 2000,
      reject: false,
      maxBuffer: 2_000_000,
    })
    checks.push({
      kind: command.kind,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      command: `${command.command} ${command.args.join(' ')}`,
      exitCode: result.exitCode,
      output: bounded(`${result.stdout}\n${result.stderr}`),
    })
  }
  for (const kind of ['typecheck', 'build', 'test', 'devtools'] as const) {
    if (!checks.some(c => c.kind === kind)) {
      checks.push({
        kind,
        status: 'unverified',
        output:
          kind === 'devtools'
            ? 'No real DevTools verification command configured. Web preview is not WeChat runtime evidence.'
            : 'No verification command configured.',
      })
    }
  }
  return {
    passed:
      checks.some(c => c.status === 'passed')
      && !checks.some(c => c.status === 'failed'),
    checks,
  }
}
export function verificationTool(
  config: AgentConfig,
  fingerprint: string,
): Tool {
  return {
    name: 'verify_project',
    description:
      'Run configured typecheck/build/test/DevTools commands and return separate passed, failed and unverified results. Fix failures, then rerun. Missing checks are never considered passed.',
    schema: z.object({}).strict(),
    mutates: true,
    async execute(_input, context) {
      const report = await verifyProject(config, context, fingerprint)
      return { text: JSON.stringify(report, null, 2), data: report }
    },
  }
}

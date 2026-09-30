import type { AgentConfig } from '@weapp-agent/core'

export function apiKeyVariable(config: AgentConfig['model']): string {
  return (
    config.apiKeyEnv
    ?? (config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY')
  )
}

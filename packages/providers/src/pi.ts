import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentConfig, PiModelAdapter } from '@weapp-agent/core'
import process from 'node:process'
import { streamSimple as anthropicStream } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as completionsStream } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as responsesStream } from '@earendil-works/pi-ai/api/openai-responses'
import { apiKeyVariable } from './credentials.js'

/** Explicit configuration only: no discovery of other agents' credentials. */
export function createPiModel(config: AgentConfig['model'], environment: NodeJS.ProcessEnv = process.env): PiModelAdapter {
  const variable = apiKeyVariable(config)
  const apiKey = environment[variable]
  if (!apiKey) {
    throw new Error(`Set ${variable} in your environment. Credentials are never read from other agents or stored in project config.`)
  }
  if (config.provider === 'openai-compatible' && !config.baseURL) {
    throw new Error('openai-compatible requires model.baseURL')
  }
  const model: Model<Api> = {
    id: config.name,
    name: config.name,
    api: config.provider === 'anthropic' ? 'anthropic-messages' : config.provider === 'openai-compatible' ? 'openai-completions' : 'openai-responses',
    provider: config.provider === 'anthropic' ? 'anthropic' : config.provider === 'openai-compatible' ? 'weapp-compatible' : 'openai',
    baseUrl: config.baseURL ?? (config.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
    reasoning: false,
    input: ['text', 'image'],
    // Local metadata, not a claim about the configured model's actual limits/prices.
    // Weapp's character budget and the provider enforce limits; no cost is reported.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 8192,
  }
  return {
    id: `${config.provider}/${config.name}`,
    model,
    stream: (_model, context, options) => {
      const request = { ...options, apiKey, maxTokens: 8192 }
      if (model.api === 'anthropic-messages') {
        return anthropicStream(model as Model<'anthropic-messages'>, context, request)
      }
      if (model.api === 'openai-completions') {
        return completionsStream(model as Model<'openai-completions'>, context, request)
      }
      return responsesStream(model as Model<'openai-responses'>, context, request)
    },
  }
}

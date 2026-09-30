import { expect, it } from 'vitest'
import { createPiModel } from '../src/index.js'

it.each([
  ['openai', 'openai-responses', 'https://api.openai.com/v1'],
  ['anthropic', 'anthropic-messages', 'https://api.anthropic.com'],
  ['openai-compatible', 'openai-completions', 'https://compatible.example/v1'],
] as const)('maps %s to the intended Pi API without model catalog substitution', (provider, api, baseUrl) => {
  const adapter = createPiModel({ provider, name: 'explicit-model', ...(provider === 'openai-compatible' ? { baseURL: baseUrl } : {}) }, { OPENAI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test' })
  expect(adapter.model).toMatchObject({ id: 'explicit-model', api, baseUrl, maxTokens: 8192, reasoning: false })
})

it('requires explicit credentials and endpoint, supports custom key variables', () => {
  expect(() => createPiModel({ provider: 'openai', name: 'test' }, {})).toThrow('OPENAI_API_KEY')
  expect(() => createPiModel({ provider: 'anthropic', name: 'test' }, {})).toThrow('ANTHROPIC_API_KEY')
  expect(() => createPiModel({ provider: 'openai-compatible', name: 'test' }, { OPENAI_API_KEY: 'test' })).toThrow('baseURL')
  const adapter = createPiModel({ provider: 'openai', name: 'test', apiKeyEnv: 'CUSTOM_KEY', baseURL: 'https://custom.example/v1' }, { CUSTOM_KEY: 'test' })
  expect(adapter.model.baseUrl).toBe('https://custom.example/v1')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePromptQuality } from '../shared/prompt-quality.mjs'

test('accepts descriptive Chinese prompts', () => {
  const result = evaluatePromptQuality('清晨海边日出风景照片，柔和光线，真实摄影质感')
  assert.equal(result.ok, true)
})

test('accepts descriptive English prompts', () => {
  const result = evaluatePromptQuality('cinematic portrait of a traveler standing beside a rainy neon street')
  assert.equal(result.ok, true)
})

test('rejects short prompts', () => {
  const result = evaluatePromptQuality('小猫')
  assert.equal(result.ok, false)
})

test('rejects punctuation-heavy prompts', () => {
  const result = evaluatePromptQuality('!!!!!!!!!??????')
  assert.equal(result.ok, false)
})

const PLACEHOLDER_WORDS = new Set([
  'test',
  'demo',
  'hello',
  'prompt',
  'image',
  'null',
  'undefined',
  '测试',
  '随便',
  '图片',
  '生成',
  '无'
])

export function evaluatePromptQuality(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')

  if (!text) {
    return { ok: false, reason: '提示词不能为空' }
  }

  const cjkCount = countMatches(text, /\p{Script=Han}/gu)
  const words = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) || []
  const visible = text.replace(/\s/g, '')
  const punctuationCount = countMatches(visible, /[^\p{L}\p{N}]/gu)
  const punctuationRatio = visible.length ? punctuationCount / visible.length : 1

  if (punctuationRatio > 0.55) {
    return { ok: false, reason: '提示词中有效内容过少' }
  }

  if (hasLongRepeatedRun(visible)) {
    return { ok: false, reason: '提示词存在大量重复字符' }
  }

  if (isMostlyPlaceholder(text, words)) {
    return { ok: false, reason: '提示词内容过于占位或泛化' }
  }

  if (cjkCount >= 12 || words.length >= 8) {
    return { ok: true, reason: '' }
  }

  return { ok: false, reason: '中文提示词至少 12 个汉字，英文提示词至少 8 个有效单词' }
}

function countMatches(text, pattern) {
  return Array.from(text.matchAll(pattern)).length
}

function hasLongRepeatedRun(text) {
  return /(.)\1{5,}/u.test(text)
}

function isMostlyPlaceholder(text, words) {
  const compact = text.toLowerCase().replace(/\s+/g, '')
  if (PLACEHOLDER_WORDS.has(compact)) {
    return true
  }

  if (words.length > 0) {
    const placeholderWordCount = words.filter((word) => PLACEHOLDER_WORDS.has(word.toLowerCase())).length
    return placeholderWordCount / words.length > 0.6
  }

  const chars = Array.from(compact)
  const placeholderChars = chars.filter((char) => PLACEHOLDER_WORDS.has(char)).length
  return chars.length > 0 && placeholderChars / chars.length > 0.75
}

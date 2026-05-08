import assert from 'node:assert/strict'
import test from 'node:test'
import {
  escapeJsonSearchLike,
  findSimilarPromptGroups,
  normalizePrompt,
  normalizePromptForSimilarity,
  parseArgs,
  promptSimilarity,
  referenceStoragePaths,
  selectKeeper,
  uniqueStoragePaths
} from '../scripts/cleanup-duplicate-prompts.mjs'

test('normalizes prompts with trim, whitespace folding, and lowercase', () => {
  assert.equal(
    normalizePrompt('  A   PROMPT\twith\nspaces  '),
    'a prompt with spaces'
  )
})

test('does not enable similar prompt matching by default', () => {
  const options = parseArgs([])
  assert.equal(options.similarPrompts, false)
  assert.equal(options.similarityThreshold, 92)
})

test('parses similar prompt matching options', () => {
  const options = parseArgs(['--similar-prompts', '--similar-threshold', '92'])
  assert.equal(options.similarPrompts, true)
  assert.equal(options.similarityThreshold, 92)
})

test('normalizes prompt text for similarity without dropping content', () => {
  assert.equal(
    normalizePromptForSimilarity('  A prompt, with --ar 9:16；人物 2  '),
    'apromptwithar916人物2'
  )
})

test('matches lightly edited prompts above the similar threshold', () => {
  const base = 'Cinematic portrait of a woman in a red dress beside a neon city window, 50mm lens, soft rim light.'
  const edited = 'cinematic portrait of a woman in red dress beside a neon city window 50mm lens soft rim light'

  assert.ok(promptSimilarity(base, edited) >= 92)
})

test('keeps clearly different prompts below the similar threshold', () => {
  const base = 'Cinematic portrait of a woman in a red dress beside a neon city window.'
  const different = 'Minimal product render of a glass teapot on a white studio table.'

  assert.ok(promptSimilarity(base, different) < 92)
})

test('similar prompt grouping only includes duplicates directly matching the keeper', () => {
  const base = 'abcdefghijklmnopqrstuvwxyz'.repeat(4)
  const replaceRange = (value, index, replacement) => (
    value.slice(0, index) + replacement + value.slice(index + replacement.length)
  )

  const groups = findSimilarPromptGroups([
    row({
      id: 'keeper',
      favoriteCount: 10,
      prompt: replaceRange(base, 10, 'xxxx')
    }),
    row({
      id: 'middle',
      favoriteCount: 1,
      prompt: base
    }),
    row({
      id: 'tail',
      favoriteCount: 1,
      prompt: replaceRange(base, 50, 'yyyy')
    })
  ], 92)

  assert.equal(groups.length, 1)
  assert.equal(groups[0].keeper.id, 'keeper')
  assert.deepEqual(groups[0].duplicates.map((match) => match.row.id), ['middle'])
})

test('selects a published keeper before higher ranked non-published rows', () => {
  const keeper = selectKeeper([
    row({ id: 'z', reviewStatus: 'PENDING', favoriteCount: 99, createdAt: '2026-01-03T00:00:00.000Z' }),
    row({ id: 'a', reviewStatus: 'PUBLISHED', favoriteCount: 1, createdAt: '2026-01-01T00:00:00.000Z' })
  ])

  assert.equal(keeper.id, 'a')
})

test('selects by favorite count, then newest createdAt, then largest id', () => {
  assert.equal(selectKeeper([
    row({ id: 'a', favoriteCount: 2, createdAt: '2026-01-03T00:00:00.000Z' }),
    row({ id: 'b', favoriteCount: 3, createdAt: '2026-01-01T00:00:00.000Z' })
  ]).id, 'b')

  assert.equal(selectKeeper([
    row({ id: 'a', favoriteCount: 3, createdAt: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'b', favoriteCount: 3, createdAt: '2026-01-03T00:00:00.000Z' })
  ]).id, 'b')

  assert.equal(selectKeeper([
    row({ id: 'a', favoriteCount: 3, createdAt: '2026-01-03T00:00:00.000Z' }),
    row({ id: 'b', favoriteCount: 3, createdAt: '2026-01-03T00:00:00.000Z' })
  ]).id, 'b')
})

test('extracts reference storage paths from object arrays and json strings', () => {
  assert.deepEqual(referenceStoragePaths([
    { storagePath: 'references/a.png' },
    { url: 'https://example.com/remote.png' },
    { storagePath: '  references/b.webp  ' }
  ]), ['references/a.png', 'references/b.webp'])

  assert.deepEqual(
    referenceStoragePaths('[{"storagePath":"references/c.png"}]'),
    ['references/c.png']
  )
})

test('deduplicates storage paths from image rows and references', () => {
  assert.deepEqual(uniqueStoragePaths(
    [{ storagePath: 'third-party/a.png' }, { storagePath: 'third-party/a.png' }],
    ['references/a.png', 'references/a.png']
  ), ['third-party/a.png', 'references/a.png'])
})

test('escapes JSON_SEARCH LIKE wildcards without backslash SQL literals', () => {
  assert.equal(
    escapeJsonSearchLike('third-party/100%_#a.png'),
    'third-party/100#%#_##a.png'
  )
})

test('parses delete concurrency with a safe sequential default', () => {
  assert.equal(parseArgs([]).deleteConcurrency, 1)
  assert.equal(parseArgs(['--delete-concurrency', '5']).deleteConcurrency, 5)
  assert.throws(
    () => parseArgs(['--delete-concurrency', '0']),
    /--delete-concurrency must be a positive integer/
  )
})

function row(overrides) {
  return {
    id: 'a',
    reviewStatus: 'PUBLISHED',
    favoriteCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

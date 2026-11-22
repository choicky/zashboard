// Decide whether a merge changes what a release ships (policy C).
// A release is skipped when, since the newest stable tag contained in the
// merge, only paths that never reach the packaged dashboard changed: docs,
// CI, tests, release helpers and repository metadata. Anything else, and
// any doubt, counts as a product change.
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 || !args[index + 1] ? undefined : args[index + 1]
}
const repo = option('--repo')
const sha = option('--sha')
const tags = JSON.parse(option('--tags') ?? '[]')
if (!repo || !/^[0-9a-f]{40}$/.test(sha || '')) {
  throw new Error('expected --repo <dir> --sha <40-hex> [--tags <json from release-state>]')
}

// Directories and root files that are not inputs to `vite build`.
const NON_PRODUCT_DIRS = ['docs/', '.github/', 'test/', 'scripts/', 'readme/', '.husky/']
const NON_PRODUCT_FILES = new Set([
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'LICENSE',
  '.gitignore',
  '.editorconfig',
  '.prettierrc.json',
  '.lintstagedrc.yaml',
  'eslint.config.js',
  'Dockerfile',
  '.dockerignore',
  'Caddyfile',
])
const isNonProduct = (path) =>
  NON_PRODUCT_FILES.has(path) || NON_PRODUCT_DIRS.some((dir) => path.startsWith(dir))

const git = (...command) =>
  execFileSync('git', ['-C', repo, ...command], { encoding: 'utf8' }).trim()
const isAncestor = (ancestor, descendant) => {
  try {
    git('merge-base', '--is-ancestor', ancestor, descendant)
    return true
  } catch {
    return false
  }
}
const version = (name) => name.slice(4).split('.').map(Number)
const newer = (a, b) => {
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index]
  return false
}

const report = (relevant, reason, files = []) => {
  console.log(`relevant=${relevant}`)
  console.log(`reason=${reason}`)
  if (files.length) console.log(`files=${files.join(' ')}`)
  process.exit(0)
}

// A tag already at this commit means an earlier run decided to release it;
// keep recovery working instead of re-deciding.
if (tags.some((tag) => tag.sha === sha)) report(true, 'a stable tag already points at this merge')

const base = tags
  .filter((tag) => tag.sha !== sha && isAncestor(tag.sha, sha))
  .reduce((best, tag) => (!best || newer(version(tag.name), version(best.name)) ? tag : best), null)
if (!base) report(true, 'no earlier stable release is contained in this merge')

const changed = git('diff', '--name-only', base.sha, sha).split('\n').filter(Boolean)
const product = changed.filter((path) => !isNonProduct(path))
if (product.length) {
  report(true, `product files changed since ${base.name}`, product.slice(0, 20))
}
report(false, `only docs, CI, tests or metadata changed since ${base.name}`, changed.slice(0, 20))

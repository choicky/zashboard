// Authoritative "what did upstream add" range for synchronization PRs.
// The merge base, not either branch tip, defines the upstream-only commits
// and files; a custom-only file must never appear in the PR description.
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 || !args[index + 1] ? fallback : args[index + 1]
}

const repo = option('--repo', '.')
const custom = option('--custom', 'origin/custom')
const upstream = option('--upstream', 'upstream/main')
const git = (...command) =>
  execFileSync('git', ['-C', repo, ...command], { encoding: 'utf8' }).trim()

const base = git('merge-base', custom, upstream)
const range = `${base}..${upstream}`
const commits = Number(git('rev-list', '--count', '--no-merges', range))
const files = git('diff', '--name-only', range).split('\n').filter(Boolean)
const log = git('log', '--oneline', '--no-merges', range).split('\n').filter(Boolean)
const sensitivePattern = /sing.?box|src\/gen\/|vendor\/|backend|api|assembly|proto/i
const sensitive = files.filter((file) => sensitivePattern.test(file))

console.log(
  JSON.stringify({
    base,
    range,
    commits,
    log,
    files,
    sensitive,
    upstream: git('rev-parse', upstream),
  }),
)

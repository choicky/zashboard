// Gate automatic release creation on real PR metadata from `gh pr view`.
// Validation success is proven by the reusable workflow dependency in the
// caller, not by a flag this script generates for itself.
const required = [
  'REPO',
  'EVENT_NAME',
  'PR_MERGED',
  'PR_BASE',
  'PR_HEAD_REPO',
  'MERGE_SHA',
  'CUSTOM_SHA',
]

const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  console.error(`missing release eligibility inputs: ${missing.join(', ')}`)
  process.exit(1)
}

const fail = (reason) => {
  console.error(`not eligible for automatic release: ${reason}`)
  process.exit(1)
}

if (process.env.EVENT_NAME !== 'pull_request' && process.env.EVENT_NAME !== 'workflow_dispatch') {
  fail(`unsupported event ${process.env.EVENT_NAME}`)
}
if (process.env.PR_MERGED !== 'true') fail('PR was closed without merging')
if (process.env.PR_BASE !== 'custom') fail(`base branch is ${process.env.PR_BASE}, expected custom`)
if (process.env.PR_HEAD_REPO !== process.env.REPO)
  fail('head branch comes from a different repository')
if (!/^[0-9a-f]{40}$/.test(process.env.MERGE_SHA)) fail('merge commit SHA is invalid')
if (process.env.MERGE_SHA !== process.env.CUSTOM_SHA) {
  fail('merge commit is not the reviewed HEAD of custom')
}

console.log('eligible=true')
console.log(`merge_sha=${process.env.MERGE_SHA}`)

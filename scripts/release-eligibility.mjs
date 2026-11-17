// Gate automatic release creation on a reviewed sync PR merge.
// All inputs are passed as environment variables so the check is testable
// without network access; the workflow resolves PR fields through `gh` first.
const required = [
  'REPO',
  'EVENT_NAME',
  'PR_MERGED',
  'PR_BASE',
  'PR_HEAD',
  'PR_HEAD_REPO',
  'MERGE_SHA',
  'CUSTOM_SHA',
  'VALIDATED',
  'VALIDATION_SHA',
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
if (process.env.PR_HEAD !== 'main') fail(`head branch is ${process.env.PR_HEAD}, expected main`)
if (process.env.PR_HEAD_REPO !== process.env.REPO)
  fail('head branch comes from a different repository')
if (!/^[0-9a-f]{40}$/.test(process.env.MERGE_SHA)) fail('merge commit SHA is invalid')
if (process.env.MERGE_SHA !== process.env.CUSTOM_SHA) {
  fail('merge commit is not the reviewed HEAD of custom')
}
if (process.env.VALIDATED !== 'true') fail('no successful validation for the merge result')
if (process.env.VALIDATION_SHA !== process.env.MERGE_SHA) {
  fail('validation result is for a different SHA')
}

console.log('eligible=true')
console.log(`merge_sha=${process.env.MERGE_SHA}`)

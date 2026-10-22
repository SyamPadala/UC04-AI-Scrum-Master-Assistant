/**
 * Process rules 1 and 11 (SDD), checked on this machine before every commit.
 * Run by the git commit-msg hook in .githooks/ — not a pipeline, nothing runs
 * on a server. Switched on once per clone with:
 *
 *   git config core.hooksPath .githooks
 *
 * A commit that changes code must name at least one spec (SPEC-NNN) in its
 * message, and every spec it names must be Approved. Documentation-only
 * commits are not checked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')

/** Paths that count as code: anything that changes what runs or how it is built. */
export const isCode = (file) =>
  /^(src|scripts|eval|test|appPackage)\//.test(file) ||
  ['Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json'].includes(file)

/** The Status cell of a spec file, or undefined when the spec does not exist. */
export function specStatus (id, specsDir = path.join(root, 'docs', 'specs')) {
  const file = fs.readdirSync(specsDir).find((f) => f.startsWith(`${id}-`))
  if (file === undefined) return undefined
  const match = fs.readFileSync(path.join(specsDir, file), 'utf8').match(/^\|\s*\*\*Status\*\*\s*\|\s*(.*?)\s*\|\s*$/m)
  return match?.[1] ?? ''
}

/** Returns the problems with a commit, empty when it may go ahead. */
export function checkCommit (message, files, statusOf = specStatus) {
  if (/^(Merge|Revert) /.test(message)) return []
  const code = files.filter(isCode)
  if (code.length === 0) return []
  const ids = [...new Set(message.match(/SPEC-\d{3}/g) ?? [])]
  if (ids.length === 0) {
    return [`This commit changes code (${code.slice(0, 3).join(', ')}${code.length > 3 ? ', …' : ''}) but names no spec. Put the spec id in the message, e.g. "SPEC-004 item 43: …".`]
  }
  const problems = []
  for (const id of ids) {
    const status = statusOf(id)
    if (status === undefined) problems.push(`${id} does not exist in docs/specs.`)
    else if (!/^Approved\b/.test(status)) problems.push(`${id} is not Approved (status: "${status.slice(0, 60)}"). Get it approved before committing code for it.`)
  }
  return problems
}

if ((process.argv[1] ?? '').endsWith('check-commit.mjs')) {
  const message = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n')
  const files = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean)
  const problems = checkCommit(message, files)
  if (problems.length > 0) {
    console.error('\nCommit stopped by the spec check (docs/rules/process-rules.md, rules 1 and 11):')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('')
    process.exit(1)
  }
}

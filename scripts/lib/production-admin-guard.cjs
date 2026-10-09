'use strict'
// FUTURE-050 — hard programmatic guard for operational scripts that use Supabase admin authority
// (service-role key or a direct Postgres connection).
//
// Why: a `vercel env pull` file puts the Production service-role key on a developer machine, and any script that
// loads it can read or delete Production data (FUTURE-048). A script must now be invoked with the project ref of
// the database it is about to touch:
//
//   node scripts/<name>.mjs --admin-project-ref=<ref>
//
// The ref must equal the one parsed from the target URL/connection string the script is about to use. It is a
// typed fact about the target, not a y/n prompt: an automated caller cannot satisfy it by accident, and a wrong
// project (or "I thought this was staging") fails before any request is sent. Nothing is read from the environment
// to satisfy it, so a stale shell variable cannot silently authorise a run.
//
// Exit code 2 = refused. No network or database call happens before this check.

const REF_FROM_HTTPS = /^https?:\/\/([a-z0-9]{20})\.supabase\.co(?::\d+)?(?:\/|$)/i
const REF_FROM_DB_HOST = /@db\.([a-z0-9]{20})\.supabase\.co\b/i
const REF_FROM_POOLER_USER = /\/\/postgres\.([a-z0-9]{20})[:@]/i

function projectRefFrom(target) {
  if (typeof target !== 'string') return null
  for (const pattern of [REF_FROM_HTTPS, REF_FROM_DB_HOST, REF_FROM_POOLER_USER]) {
    const match = target.match(pattern)
    if (match) return match[1].toLowerCase()
  }
  return null
}

function flagValue(argv) {
  const entry = argv.find((arg) => typeof arg === 'string' && arg.startsWith('--admin-project-ref='))
  return entry ? entry.slice('--admin-project-ref='.length).trim().toLowerCase() : null
}

/**
 * @param {{ script: string, target: string | undefined, argv?: string[], exit?: (code: number) => never, log?: (line: string) => void }} options
 * @returns {string} the confirmed project ref
 */
function requireAdminAck({ script, target, argv = process.argv, exit = process.exit, log = console.error }) {
  const ref = projectRefFrom(target)
  const given = flagValue(argv)
  if (!ref) {
    log(`[admin-guard] ${script}: cannot determine the Supabase project ref of its target. Refusing to run.`)
    return exit(2)
  }
  if (given !== ref) {
    log(`[admin-guard] ${script}: refusing to use admin credentials against project "${ref}".`)
    log(`[admin-guard] Re-run with --admin-project-ref=${ref} ONLY if you intend to operate on that exact project.`)
    return exit(2)
  }
  return ref
}

module.exports = { projectRefFrom, requireAdminAck }

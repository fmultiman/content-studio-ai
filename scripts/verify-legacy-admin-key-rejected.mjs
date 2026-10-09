/**
 * FUTURE-052 — prove, without writing anything, whether the legacy JWT-based admin credential still works.
 *
 * Read-only: three `GET /rest/v1/<table>?select=id&limit=1` requests (Range 0-0, count=exact). It prints HTTP
 * statuses, the row total PostgREST reports, and a verdict. It never prints, logs or echoes any key.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...> \
 *   LEGACY_KEY_UNDER_TEST=<the compromised legacy JWT, read from your secret store — never typed into a shared shell> \
 *     node scripts/verify-legacy-admin-key-rejected.mjs --admin-project-ref=<ref>
 *
 * Probes (the table has RLS and rows, so an RLS-bypassing credential sees a non-zero total and an ordinary caller sees 0):
 *   A  apikey = legacy key + Authorization: Bearer legacy  (how supabase-js and the repo's raw-REST scripts use it; the hosted
 *                                                              gateway does not promote a bare legacy apikey to a role)
 *   B  apikey = publishable key, Authorization: Bearer legacy (a leaked JWT used as a bearer token behind a valid public key —
 *                                                              this is the path that survives "disabling API keys" if the
 *                                                              legacy JWT secret is still trusted)
 *   C  apikey = publishable key alone                       (control: must see 0 rows)
 *
 * Verdict per probe: REJECTED (401/403, or 200 with total 0) or STILL_VALID (RLS-bypassing: total > 0).
 * Exit code 0 = A and B both REJECTED, 1 = at least one STILL_VALID, 2 = refused by the admin guard / bad input.
 */
import adminGuard from './lib/production-admin-guard.cjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
const legacy = process.env.LEGACY_KEY_UNDER_TEST ?? ''
const table = process.env.PROBE_TABLE ?? 'media_reviews'

if (!url || !publishable || !legacy) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and LEGACY_KEY_UNDER_TEST are required.')
  process.exit(2)
}
adminGuard.requireAdminAck({ script: 'verify-legacy-admin-key-rejected', target: url })

async function probe(label, headers) {
  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?select=id&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  const total = Number((response.headers.get('content-range') ?? '').split('/')[1])
  const stillValid = (response.status === 200 || response.status === 206) && Number.isFinite(total) && total > 0
  console.log(`${label}  status=${response.status}  total=${Number.isFinite(total) ? total : 'n/a'}  ${stillValid ? 'STILL_VALID' : 'REJECTED'}`)
  return stillValid
}

const a = await probe('A apikey=legacy + Bearer legacy           ', { apikey: legacy, Authorization: `Bearer ${legacy}` })
const b = await probe('B apikey=publishable + Bearer legacy      ', { apikey: publishable, Authorization: `Bearer ${legacy}` })
const c = await probe('C apikey=publishable (control)           ', { apikey: publishable })
if (c) console.log('CONTROL SEES ROWS: the probe table is readable without admin authority; the result is not conclusive.')
console.log(a || b ? 'LEGACY_ADMIN_CREDENTIAL_STILL_VALID' : 'LEGACY_ADMIN_CREDENTIAL_REJECTED')
process.exit(a || b ? 1 : 0)

#!/usr/bin/env node
/**
 * USAGE_SETTINGS_POLISH_AND_HISTORICAL_PROOFS_V1
 *
 * One-shot import of exactly THREE verified historical usage facts into
 * `provider_usage_events` (see lib/usage/historical-proofs.ts for the allowlist,
 * the verification rules and why it is not a general backfill).
 *
 * DRY RUN is the default: nothing is written unless --apply is passed.
 *
 * Online (needs a server credential; never printed):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-verified-provider-usage-proofs.mjs            # dry run
 *   ... node scripts/backfill-verified-provider-usage-proofs.mjs --apply  # insert
 *
 * Offline (no network, never writes; for operators that can only run SQL):
 *   node scripts/backfill-verified-provider-usage-proofs.mjs --from-json rows.json [--emit-sql]
 *   where rows.json = { "generations": [ <video_generations rows> ], "existingKeys": [ <idempotency keys> ] }
 *
 * Idempotent: the canonical key `video_generation:{id}:completed` is unique, the
 * insert is ON CONFLICT DO NOTHING, so a second run adds zero rows.
 * The importer exits non-zero, and inserts nothing, if ANY of the three proofs
 * does not match the trusted database row.
 */

import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

// The core is TypeScript; bundle it once into a throw-away module (resolves the "@/..." alias).
async function loadCore() {
  const outfile = resolve(ROOT, 'node_modules/.cache/historical-usage-proofs/core.mjs')
  mkdirSync(dirname(outfile), { recursive: true })
  await build({
    entryPoints: [resolve(ROOT, 'lib/usage/historical-proofs.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@': ROOT },
    external: ['@supabase/supabase-js'],
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

async function main() {
  const core = await loadCore()
  const apply = flag('--apply')
  const fromJson = option('--from-json')

  if (fromJson) {
    if (apply) throw new Error('--apply cannot be combined with --from-json (offline mode never writes)')
    const input = JSON.parse(readFileSync(resolve(fromJson), 'utf8'))
    const plan = core.planBackfill(input.generations ?? [], new Set(input.existingKeys ?? []))
    console.log(core.formatPlan(plan, 'dry-run'))
    if (!plan.ok) process.exitCode = 1
    else if (flag('--emit-sql')) console.log(`\n${core.toInsertSql(plan) ?? '-- nothing to insert'}`)
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or use --from-json)')
  const { default: adminGuard } = await import('./lib/production-admin-guard.cjs')
  adminGuard.requireAdminAck({ script: 'backfill-verified-provider-usage-proofs', target: url })
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const plan = await core.loadAndPlanBackfill(db)
  console.log(core.formatPlan(plan, apply ? 'apply' : 'dry-run'))
  if (!plan.ok) {
    process.exitCode = 1
    return
  }
  if (!apply) {
    console.log('\nDry run: nothing was written. Re-run with --apply to insert the missing events.')
    return
  }
  const attempted = await core.applyBackfill(db, plan)
  const after = await core.loadAndPlanBackfill(db)
  console.log(`\nApplied: ${attempted} insert(s) attempted. Check: missing=${after.toInsert.length} already_present=${after.alreadyPresent}`)
  if (after.toInsert.length !== 0) process.exitCode = 1
}

main().catch((error) => {
  // Only the message: never a payload or credential.
  console.error(`backfill failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
})

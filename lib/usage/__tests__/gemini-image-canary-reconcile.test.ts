import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { STUBS, script } from '@/lib/reviews/__tests__/pglite-review-schema'
import { GEMINI_IMAGE_CANARY_USAGE as CANARY } from '@/lib/__tests__/helpers/gemini-image-canary'

const ATTEMPT = '56ba444f-0280-4675-aa2a-ec90267e8eb8'
const USER = '35428fd4-4784-4934-9af9-82a606aad77e'
const dir = join(process.cwd(), 'docs/productization/sql')
const dryRun = readFileSync(join(dir, 'FUTURE_064_CANARY_accounting_dry_run.sql'), 'utf8')
const reconcile = readFileSync(join(dir, 'FUTURE_064_CANARY_accounting_reconcile.sql'), 'utf8')
// Production stored descriptors omit promptTokenCount; the input ledger row is its evidence.
const { promptTokenCount: _input, ...storedUsage } = CANARY
void _input
const metadata = { usage: storedUsage, funding: 'user_byok', image_generation: { attempt_id: ATTEMPT }, provider_response: 'received' }
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  await db.exec('CREATE TABLE public.provider_connections (id uuid PRIMARY KEY)')
  await db.exec(script('044_create_provider_usage_events.sql'))
  await db.exec('ALTER TABLE public.image_generation_attempts ADD COLUMN provider text, ADD COLUMN model text, ADD COLUMN status text')
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [USER])
  await db.query('INSERT INTO image_generation_attempts (id,user_id,provider,model,status) VALUES ($1,$2,$3,$4,$5)', [ATTEMPT, USER, 'gemini', 'gemini-nb-2.1', 'succeeded'])
  for (const [key, quantity, unit, category] of [
    ['input_tokens', 29, 'input_tokens', null], ['image_output_tokens', 1120, 'tokens', 'image_output'], ['thoughts_tokens', 868, 'tokens', 'thoughts'],
  ]) {
    await db.query(`INSERT INTO provider_usage_events
      (user_id,provider,transport,operation,model,resource_type,resource_id,provider_task_id,quantity,unit,measurement_source,provider_metadata,idempotency_key,occurred_at)
      VALUES ($1,'gemini','rest','image_generation','gemini-nano-banana-2.1','image_generation_attempt',$2,'response', $3,$4,'provider_reported',$5,$6,'2026-10-12T07:55:50.234847Z')`,
    [USER, ATTEMPT, quantity, unit, category ? { ...metadata, usage_category: category } : metadata, `gemini_image:${ATTEMPT}:${key}`])
  }
}, 60_000)
afterAll(async () => { await db?.close() })

type LedgerRow = { id: string; quantity: string; unit: string; provider_metadata: unknown; idempotency_key: string; occurred_at: Date }
const rows = async () => (await db.query<LedgerRow>('SELECT id,quantity,unit,provider_metadata,idempotency_key,occurred_at FROM provider_usage_events ORDER BY idempotency_key')).rows

describe('exact historical canary reconciliation (isolated PGlite only)', () => {
  it('dry run proves 315 tokens using stored descriptors and writes nothing', async () => {
    const before = await rows()
    expect((await db.query(dryRun)).rows[0]).toMatchObject({
      attempt_id: ATTEMPT, input_tokens: '29', candidate_tokens: '1435', attributed_tokens: '1120',
      proposed_output_unattributed_tokens: '315', metadata_sufficient: true, existing_remainder_rows: 0, distinct_usage_snapshots: 1,
    })
    expect(await rows()).toEqual(before)
  })

  it.each([
    { modality: 'TEXT' }, { tokenCount: 10 }, { modality: 'TEXT', tokenCount: 'bad' },
  ])('dry run and reconciliation both refuse incomplete breakdown %j', async (incomplete) => {
    await db.query('UPDATE provider_usage_events SET provider_metadata = $1 WHERE idempotency_key = $2', [
      { ...metadata, usage: { ...storedUsage, candidatesTokensDetails: [...storedUsage.candidatesTokensDetails, incomplete] } },
      `gemini_image:${ATTEMPT}:input_tokens`,
    ])
    const before = await rows()
    expect((await db.query(dryRun)).rows[0]).toMatchObject({ metadata_sufficient: false, proposed_output_unattributed_tokens: null })
    await expect(db.exec(reconcile)).rejects.toThrow(/insufficient/)
    expect(await rows()).toEqual(before)
    await db.query('UPDATE provider_usage_events SET provider_metadata = $1 WHERE idempotency_key = $2', [metadata, `gemini_image:${ATTEMPT}:input_tokens`])
  })

  it('appends exactly one unpriced event, preserves original rows/time, and repeated execution is a no-op', async () => {
    const before = await rows()
    await db.exec(reconcile)
    const after = await rows()
    expect(after).toHaveLength(4)
    for (const original of before) expect(after).toContainEqual(original)
    const added = after.find((row) => row.idempotency_key === `gemini_image:${ATTEMPT}:output_unattributed_tokens`)!
    expect(added).toMatchObject({ quantity: '315', unit: 'tokens', provider_metadata: { usage_category: 'output_unattributed', usage: storedUsage } })
    expect(added.occurred_at).toEqual(before[0].occurred_at)
    await db.exec(reconcile)
    expect(await rows()).toEqual(after)
  })

  it('refuses conflicting existing rows transactionally', async () => {
    await db.query('UPDATE provider_usage_events SET quantity = 999 WHERE idempotency_key = $1', [`gemini_image:${ATTEMPT}:output_unattributed_tokens`])
    const before = await rows()
    await expect(db.exec(reconcile)).rejects.toThrow(/conflicts with stored evidence/)
    expect(await rows()).toEqual(before)
  })

  it('refuses missing source usage without inserting anything', async () => {
    await db.query('UPDATE provider_usage_events SET provider_metadata = $1 WHERE idempotency_key = $2', [{ ...metadata, usage: {} }, `gemini_image:${ATTEMPT}:input_tokens`])
    const before = await rows()
    await expect(db.exec(reconcile)).rejects.toThrow(/insufficient/)
    expect(await rows()).toEqual(before)
  })
})

// Test-only: a minimal supabase-js query-builder translator that runs the REPOSITORY's real calls
// (`from(t).update().eq().in().lt().select().maybeSingle()` etc.) as SQL against the REAL migrated PGlite schema.
// It owns no schema and no rules (constraints, triggers and indexes are the migrations' own); it only turns the
// builder chain into a statement, so the guarded predicates are evaluated by PostgreSQL, not by JavaScript.

import type { PGlite } from '@electric-sql/pglite'

type Row = Record<string, any>
const IDENT = /^[a-z_][a-z0-9_]*$/

function normalize(row: Row): Row {
  const out: Row = {}
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Date ? value.toISOString() : value
  return out
}

export function createPgliteSupabase(pg: PGlite, calls: string[] = []) {
  return {
    calls,
    from(table: string) {
      if (!IDENT.test(table)) throw new Error('bad table')
      const where: string[] = []
      const params: unknown[] = []
      let op: 'select' | 'insert' | 'update' = 'select'
      let values: Row = {}
      let columns = '*'
      let orderBy = ''
      let limitTo = ''

      const param = (value: unknown) => { params.push(value !== null && typeof value === 'object' ? JSON.stringify(value) : value); return `$${params.length}` }
      const cast = (value: unknown) => (value !== null && typeof value === 'object' ? '::jsonb' : '')

      async function run(): Promise<{ rows: Row[]; error: { code?: string; message: string } | null }> {
        let sql: string
        if (op === 'insert') {
          const keys = Object.keys(values).filter((k) => IDENT.test(k))
          sql = `INSERT INTO public.${table} (${keys.join(',')}) VALUES (${keys.map((k) => `${param(values[k])}${cast(values[k])}`).join(',')}) RETURNING ${columns}`
        } else if (op === 'update') {
          const keys = Object.keys(values).filter((k) => IDENT.test(k))
          const sets = keys.map((k) => `${k} = ${param(values[k])}${cast(values[k])}`).join(', ')
          sql = `UPDATE public.${table} SET ${sets}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} RETURNING ${columns}`
        } else {
          sql = `SELECT ${columns} FROM public.${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${orderBy}${limitTo}`
        }
        calls.push(`${op}:${table}`)
        try {
          const result = await pg.query<Row>(sql, params)
          return { rows: result.rows.map(normalize), error: null }
        } catch (error) {
          const e = error as { code?: string; message?: string }
          return { rows: [], error: { code: e.code, message: String(e.message ?? error) } }
        }
      }

      const one = (maybe: boolean) => async () => {
        const result = await run()
        if (result.error) return { data: null, error: result.error }
        if (result.rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
        if (!result.rows.length) return maybe ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
        return { data: result.rows[0], error: null }
      }

      const builder: any = {
        select: (cols?: string) => { if (cols && cols.trim() !== '*') columns = cols.split(',').map((c) => c.trim()).filter((c) => IDENT.test(c)).join(','); return builder },
        insert: (v: Row) => { op = 'insert'; values = v; return builder },
        update: (v: Row) => { op = 'update'; values = v; return builder },
        eq: (c: string, v: unknown) => { where.push(`${c} = ${param(v)}`); return builder },
        in: (c: string, vs: unknown[]) => { where.push(`${c} IN (${vs.map((v) => param(v)).join(',')})`); return builder },
        lt: (c: string, v: unknown) => { where.push(`${c} < ${param(v)}`); return builder },
        order: (c: string, o?: { ascending?: boolean }) => { orderBy = ` ORDER BY ${c} ${o?.ascending === false ? 'DESC' : 'ASC'}`; return builder },
        limit: (n: number) => { limitTo = ` LIMIT ${Number(n)}`; return builder },
        maybeSingle: one(true),
        single: one(false),
        then: (resolve: (v: unknown) => unknown) => run().then((r) => resolve({ data: r.rows, error: r.error })),
      }
      return builder
    },
  } as any
}

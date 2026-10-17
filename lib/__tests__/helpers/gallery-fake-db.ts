import type { SupabaseClient } from '@supabase/supabase-js'

// A READ-ONLY fake of the Supabase query builder for the Gallery read model.
//
// Unlike `recording-supabase`, it INTERPRETS what the loaders send, so the tests prove the real query strings:
//   * eq / in / is / not(col, 'is', null) filters;
//   * `.or(...)` PostgREST logic trees: comma lists, `and(...)`, `or(...)`, `col.lt."v"`, `col.eq."v"`, `col.lt.v`, `col.not.is.null`;
//   * the SELECT list: only the columns that were asked for come back (so an unselected storage path can never leak),
//     including the `alias:col->>key` / `alias:col->key` JSON projections;
//   * order (several keys), limit, `count: 'exact', head: true`.
// Every write method throws. `failing` tables answer with an error; `failingHead` tables only fail count queries.

export type Row = Record<string, any>
export type Recorded = { table: string; select: string; filters: string[]; or: string[]; order: string[]; limit?: number; head: boolean; count: boolean }
export type FakeOptions = {
  /** Simulates the server's silent response cap per table (PostgREST max rows): rows beyond it are dropped, the exact count is not. */
  maxRows?: Record<string, number>
  /** Tables whose responses carry no total count. */
  noCount?: Set<string>
}

type Condition = (row: Row) => boolean

function splitTop(expression: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const character of expression) {
    if (character === '"') quoted = !quoted
    if (!quoted && character === '(') depth += 1
    if (!quoted && character === ')') depth -= 1
    if (!quoted && depth === 0 && character === ',') {
      parts.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (current) parts.push(current)
  return parts
}

const unquote = (value: string) => (value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value)

function compare(left: unknown, right: string): number {
  // Timestamps compare as instants (microsecond-safe through ISO strings of equal shape), everything else as text.
  const l = String(left)
  return l < right ? -1 : l > right ? 1 : 0
}

function parseCondition(expression: string): Condition {
  const group = /^(and|or)\(([\s\S]*)\)$/.exec(expression)
  if (group) {
    const children = splitTop(group[2]).map(parseCondition)
    return group[1] === 'and' ? (row) => children.every((child) => child(row)) : (row) => children.some((child) => child(row))
  }
  const notNull = /^([a-z_]+)\.not\.is\.null$/.exec(expression)
  if (notNull) return (row) => row[notNull[1]] !== null && row[notNull[1]] !== undefined
  const leaf = /^([a-z_]+)\.(lt|eq)\.([\s\S]+)$/.exec(expression)
  if (!leaf) throw new Error(`fake: unsupported filter ${expression}`)
  const value = unquote(leaf[3])
  return leaf[2] === 'lt' ? (row) => compare(row[leaf[1]], value) < 0 : (row) => compare(row[leaf[1]], value) === 0
}

function project(row: Row, select: string): Row {
  const out: Row = {}
  for (const raw of splitTop(select).map((part) => part.trim()).filter(Boolean)) {
    const aliased = /^([a-z_]+):([a-z_]+)(->>?)([a-z_]+)$/.exec(raw)
    if (aliased) {
      const source = row[aliased[2]]
      out[aliased[1]] = source && typeof source === 'object' ? (source[aliased[4]] ?? null) : null
    } else if (raw !== '*') {
      out[raw] = row[raw]
    } else {
      Object.assign(out, row)
    }
  }
  return out
}

export function createGalleryFakeDb(tables: Record<string, Row[]>, failing: Set<string> = new Set(), failingHead: Set<string> = new Set(), options: FakeOptions = {}) {
  const log: Recorded[] = []
  const client = {
    from(table: string) {
      const recorded: Recorded = { table, select: '', filters: [], or: [], order: [], head: false, count: false }
      const conditions: Condition[] = []
      const orders: Array<{ column: string; ascending: boolean }> = []
      let single = false
      const builder: any = {
        select(columns: string, selectOptions?: { head?: boolean; count?: string }) { recorded.select = columns; recorded.head = Boolean(selectOptions?.head); recorded.count = Boolean(selectOptions?.count); return builder },
        eq(column: string, value: unknown) { recorded.filters.push(`eq:${column}`); conditions.push((row) => row[column] === value); return builder },
        in(column: string, values: unknown[]) { recorded.filters.push(`in:${column}`); conditions.push((row) => values.includes(row[column])); return builder },
        is(column: string, value: null) { recorded.filters.push(`is:${column}`); conditions.push((row) => (row[column] ?? null) === value); return builder },
        not(column: string, operator: string, value: null) {
          if (operator !== 'is' || value !== null) throw new Error('fake: unsupported not()')
          recorded.filters.push(`notnull:${column}`)
          conditions.push((row) => row[column] !== null && row[column] !== undefined)
          return builder
        },
        or(expression: string) { recorded.or.push(expression); conditions.push(parseCondition(`or(${expression})`)); return builder },
        order(column: string, options?: { ascending?: boolean }) { recorded.order.push(column); orders.push({ column, ascending: options?.ascending !== false }); return builder },
        limit(count: number) { recorded.limit = count; return builder },
        maybeSingle() { single = true; return builder },
        insert() { throw new Error('write attempted: insert') },
        update() { throw new Error('write attempted: update') },
        upsert() { throw new Error('write attempted: upsert') },
        delete() { throw new Error('write attempted: delete') },
        then(resolve: (value: unknown) => unknown) {
          log.push(recorded)
          if (failing.has(table) || (recorded.head && failingHead.has(table))) return resolve({ data: null, error: { message: 'secret database detail' }, count: null })
          let rows = (tables[table] ?? []).filter((row) => conditions.every((condition) => condition(row)))
          rows = [...rows].sort((a, b) => {
            for (const { column, ascending } of orders) {
              const result = compare(a[column], String(b[column]))
              if (result !== 0) return ascending ? result : -result
            }
            return 0
          })
          if (recorded.head) return resolve({ data: null, error: null, count: rows.length })
          const total = rows.length
          if (recorded.limit !== undefined) rows = rows.slice(0, recorded.limit)
          const cap = options.maxRows?.[table]
          if (cap !== undefined) rows = rows.slice(0, cap)
          const projected = rows.map((row) => project(row, recorded.select))
          const count = recorded.count && !options.noCount?.has(table) ? total : null
          return resolve({ data: single ? (projected[0] ?? null) : projected, error: null, count })
        },
      }
      return builder
    },
  }
  return { db: client as unknown as SupabaseClient, log }
}

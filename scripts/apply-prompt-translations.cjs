const fs = require('fs')
const postgres = require('postgres')

function readLocalEnv() {
  const contents = fs.readFileSync('.env.local', 'utf8')

  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index)
        const value = line.slice(index + 1).replace(/^"|"$/g, '')
        return [key, value]
      }),
  )
}

async function main() {
  const env = readLocalEnv()
  const connectionString = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL

  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING ou POSTGRES_URL nao encontrado em .env.local')
  }

  const sql = postgres(connectionString, { ssl: 'require' })

  try {
    await sql.unsafe(fs.readFileSync('scripts/006_add_prompt_translations.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/010_add_image_draft_workspace_state.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/011_add_image_draft_current_image_id.sql', 'utf8'))

    const columns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'image_drafts'
        and column_name in (
          'generated_prompt_pt',
          'prompt_details',
          'current_evaluation',
          'generation_attempts',
          'current_attempt',
          'image_status',
          'current_image_id'
        )
    `

    const foundColumns = new Set(columns.map((column) => column.column_name))
    const requiredColumns = [
      'generated_prompt_pt',
      'prompt_details',
      'current_evaluation',
      'generation_attempts',
      'current_attempt',
      'image_status',
      'current_image_id',
    ]
    const missingColumns = requiredColumns.filter((column) => !foundColumns.has(column))

    if (missingColumns.length > 0) {
      throw new Error(`Colunas nao encontradas apos a migracao: ${missingColumns.join(', ')}`)
    }

    console.log('migration ok: image_drafts prompt translation, workspace state, and current image reference')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

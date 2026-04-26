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

    const [column] = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'image_drafts'
        and column_name = 'generated_prompt_pt'
    `

    if (!column) {
      throw new Error('A coluna generated_prompt_pt nao foi encontrada apos a migracao')
    }

    console.log('migration ok: image_drafts.generated_prompt_pt')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

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
    await sql.unsafe(fs.readFileSync('scripts/012_create_posts.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/013_add_storage_metadata.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/014_add_post_images.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/015_create_library_files.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/016_create_library_folders.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/017_add_library_folder_project_root.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/018_add_library_file_trash.sql', 'utf8'))
    await sql.unsafe(fs.readFileSync('scripts/019_add_project_evaluation_mode.sql', 'utf8'))

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

    const postColumns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'posts'
        and column_name in (
          'project_id',
          'name',
          'channel',
          'description',
          'ai_context',
          'feed_text',
          'image_url',
          'post_images',
          'status'
        )
    `
    const foundPostColumns = new Set(postColumns.map((column) => column.column_name))
    const requiredPostColumns = [
      'project_id',
      'name',
      'channel',
      'description',
      'ai_context',
      'feed_text',
      'image_url',
      'post_images',
      'status',
    ]
    const missingPostColumns = requiredPostColumns.filter((column) => !foundPostColumns.has(column))

    if (missingPostColumns.length > 0) {
      throw new Error(`Colunas de posts nao encontradas apos a migracao: ${missingPostColumns.join(', ')}`)
    }

    const storageColumns = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('images', 'posts')
        and column_name in (
          'thumbnail_url',
          'storage_provider',
          'storage_path',
          'thumbnail_path',
          'file_size',
          'mime_type'
        )
    `
    const storageColumnKeys = new Set(
      storageColumns.map((column) => `${column.table_name}.${column.column_name}`),
    )
    const requiredStorageColumns = ['images', 'posts'].flatMap((table) =>
      [
        'thumbnail_url',
        'storage_provider',
        'storage_path',
        'thumbnail_path',
        'file_size',
        'mime_type',
      ].map((column) => `${table}.${column}`),
    )
    const missingStorageColumns = requiredStorageColumns.filter(
      (column) => !storageColumnKeys.has(column),
    )

    if (missingStorageColumns.length > 0) {
      throw new Error(`Colunas de storage nao encontradas apos a migracao: ${missingStorageColumns.join(', ')}`)
    }

    const libraryFolderColumns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'library_folders'
        and column_name in ('id', 'user_id', 'project_id', 'name', 'path', 'parent_path', 'is_project_root')
    `
    const foundLibraryFolderColumns = new Set(libraryFolderColumns.map((column) => column.column_name))
    const requiredLibraryFolderColumns = ['id', 'user_id', 'project_id', 'name', 'path', 'parent_path', 'is_project_root']
    const missingLibraryFolderColumns = requiredLibraryFolderColumns.filter(
      (column) => !foundLibraryFolderColumns.has(column),
    )

    if (missingLibraryFolderColumns.length > 0) {
      throw new Error(`Colunas de library_folders nao encontradas apos a migracao: ${missingLibraryFolderColumns.join(', ')}`)
    }

    const projectColumns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'projects'
        and column_name = 'evaluation_mode'
    `

    if (projectColumns.length === 0) {
      throw new Error('Coluna projects.evaluation_mode nao encontrada apos a migracao')
    }

    console.log('migration ok: image_drafts workspace state, posts, storage metadata, library folders, file trash, and project evaluation mode')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

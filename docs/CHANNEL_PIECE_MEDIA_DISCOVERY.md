# ChannelPiece Media — Descoberta de Domínio
**Data:** 2026-06-22 (rev. 2 — alternativas e lacunas atualizadas após decisões humanas)  
**Status:** Descoberta concluída. Decisões aprovadas em `CHANNEL_PIECE_MEDIA_DECISIONS.md` Rev.2.

---

## 1. Motivação

`ChannelPiece` foi implementado em P1–P6 como entidade de texto: `channel`, `format`, `title`, `body`, `cta`, `hashtags`, `status`. Nenhum campo de mídia existe no schema atual.

A entidade `Post` legada suporta imagens via:
- Campo de imagem principal: `image_url`, `thumbnail_url`, `storage_provider`, `storage_path`, `thumbnail_path`, `file_size`, `mime_type`
- Campo JSONB de imagens adicionais: `post_images` (array de `PostImage`)

Enquanto esse suporte não existir em `ChannelPiece`, `Posts legados` não pode ser aposentado com segurança. Esta é a lacuna que esta fase resolve.

---

## 2. Inventário do Sistema Atual de Mídia

### 2.1 Entidades de Arquivo Físico

#### `images` (tabela)
**Migrations:** `001_create_tables.sql`, `013_add_storage_metadata.sql`  
**Natureza:** Arquivo físico + metadados. Resultado de geração de imagem por IA.

| Campo | Papel |
|-------|-------|
| `id` | Identificador da imagem gerada |
| `user_id` | Proprietário (FK → auth.users CASCADE) |
| `project_id` | Contexto de projeto (FK → projects ON DELETE SET NULL, nullable) |
| `user_input` | Intenção original do usuário |
| `generated_prompt` | Prompt técnico em inglês |
| `image_url` | URL pública no S3 (permanente) |
| `thumbnail_url` | URL pública do thumbnail WebP no S3 |
| `storage_provider` | `'s3'` |
| `storage_path` | Path no S3: `users/{userId}/images/{uuid}/original.{ext}` |
| `thumbnail_path` | Path do thumbnail: `users/{userId}/images/{uuid}/thumb.webp` |
| `file_size` | Bytes |
| `mime_type` | MIME type |
| `status` | `draft \| generating \| approved \| rejected` |
| `model` | Modelo de geração |
| `aspect_ratio` | Proporção |
| `metadata` | JSONB livre |

- **Fonte de verdade:** tabela `images` + objetos S3
- **URL:** pública (base S3) ou presigned via `/api/images/:id/signed-url` (1h TTL)
- **Thumbnail:** gerado server-side por `sharp` (360×360, WebP quality 55, fit inside, auto-rotate)
- **Exclusão:** nenhuma cascade automática para S3 — objetos podem ficar órfãos
- **Vínculo com usuário:** direto via `user_id`
- **Vínculo com Projeto:** via `project_id` nullable
- **Vínculo com Production:** nenhum FK direto; relação implícita via `ImageDraft.production_id`
- **Reutilização:** não formalizada — nenhuma FK de outras entidades aponta para `images`
- **Cópia ou referência:** referência (URL/path persistidos)
- **APIs que dependem:** `/api/images/:id/signed-url`, `/api/openai/generate-image`, `lib/storage/s3.ts`
- **Componentes que dependem:** `app/(dashboard)/imagens/page.tsx`, `app/(dashboard)/galeria/page.tsx`

---

#### `library_files` (tabela)
**Migrations:** `015_create_library_files.sql`, `016_create_library_folders.sql`, `017_`, `018_`  
**Natureza:** Arquivo físico + metadados. Upload manual do usuário. Toda mídia que não foi gerada por IA.

| Campo | Papel |
|-------|-------|
| `id` | Identificador do arquivo |
| `user_id` | Proprietário (FK → auth.users CASCADE) |
| `project_id` | Contexto de projeto (FK → projects ON DELETE SET NULL, nullable) |
| `folder` | Path de pasta virtual (ex: `/campanha-verão/`) |
| `name` | Nome do arquivo |
| `kind` | `image \| video \| audio \| document \| other` |
| `mime_type` | MIME type |
| `file_size` | Bytes |
| `storage_provider` | `'s3'` |
| `storage_path` | Path no S3: `users/{userId}/library/{prefix}/{uuid}/{nome}.{ext}` |
| `public_url` | URL pública permanente |
| `thumbnail_url` | URL de thumbnail (gerada no lado do cliente ou no upload) |
| `deleted_at` | Soft-delete timestamp |

- **Fonte de verdade:** tabela `library_files` + objetos S3
- **URL:** `public_url` (pública direta) ou presigned via `/api/library-files/:id/download`
- **Thumbnail:** campo existe, mas geração não é feita server-side via `sharp` — provavelmente definida no momento do upload ou ausente para tipos não-imagem
- **Exclusão:** soft-delete via `deleted_at`; objetos S3 só são deletados em hard-delete (não padrão atual)
- **Vínculo com usuário:** direto via `user_id`
- **Vínculo com Projeto:** via `project_id` nullable
- **Vínculo com Production:** nenhum
- **Reutilização:** conceitualmente sim (mesmo arquivo pode ser referenciado por múltiplos contextos), mas sem FK formal em nenhuma entidade
- **Cópia ou referência:** referência (URL pública, path S3)
- **APIs que dependem:** `/api/library-files`, `/api/library-files/:id/download`
- **Componentes que dependem:** `app/(dashboard)/arquivos/page.tsx`

---

### 2.2 Entidades de Workspace (não são arquivos)

#### `image_drafts` (tabela)
**Natureza:** Workspace de sessão de criação de imagem. Não é um arquivo — é o estado de trabalho.

| Campo relevante | Papel |
|----------------|-------|
| `current_image_id` | FK → images (última imagem gerada neste workspace) |
| `image_url` | URL da imagem atual (redundância com `images.image_url`, mantida para performance) |
| `production_id` | Vínculo opcional com Production (nullable, ON DELETE SET NULL) |
| `project_id` | Contexto de projeto (nullable) |
| `generation_attempts` | JSONB: histórico de tentativas com `imageId`, `imageUrl` |

- **O `image_draft` não é mídia** — ele referencia imagens via `current_image_id`
- Pode existir sem imagem associada (draft em elaboração)
- `production_id` nullable: mesma política de `editorial_contents`

---

#### `video_drafts` (tabela)
**Natureza:** Storyboard em progresso. Não contém arquivo de vídeo — geração de vídeo real não está implementada.

| Campo relevante | Papel |
|----------------|-------|
| `scenes` | JSONB: `[{id, order, description, prompt, image_url, duration, movement}]` |
| `production_id` | Vínculo opcional com Production (nullable, ON DELETE SET NULL) |
| `project_id` | Contexto de projeto (nullable) |

- **`scenes[].image_url`:** URL de imagem de referência da cena — sem FK para `images`, embedded em JSONB
- Não há arquivo de vídeo armazenado em nenhuma entidade atual
- `video_drafts` não é mídia publicável — é planejamento

---

### 2.3 Mídia Embedded no Post

#### `post_images` (JSONB em `posts.post_images`)
**Migration:** `014_add_post_images.sql`  
**Natureza:** Array JSONB de objetos de mídia adicional. Não é uma tabela separada.

```typescript
PostImage {
  id: string             // UUID gerado no cliente
  imageUrl: string       // URL pública S3
  thumbnailUrl: string   // URL do thumbnail
  storageProvider: string | null
  storagePath: string | null
  thumbnailPath: string | null
  fileSize: number | null
  mimeType: string | null
  name?: string | null
}
```

- **Sem FK:** nenhuma referência à tabela `images` ou `library_files`
- **Sem ordenação explícita:** ordem é o índice do array JSON
- **Sem limit:** nenhum CHECK no banco limita o número de imagens
- **Tipos MIME:** qualquer string — sem constraint
- **Exclusão de Post:** JSONB some junto — objetos S3 ficam órfãos
- **Exclusão de arquivo S3:** `post_images` mantém referências stale
- **Thumbnail:** gerado no cliente via `createThumbnail()` (canvas, WebP 360px/0.55) ou server-side via `uploadImageToS3`
- **Upload:** via presigned URL (`/api/storage/presign-image-upload`) — PUT direto do cliente, depois PATCH em `posts`

---

## 3. Fluxo de Upload e Ciclo de Vida da Mídia

### Fluxo A: Geração por IA (OpenAI)

```
[User input] → POST /api/openai/generate-image
    → OpenAI Images API → base64
    → uploadImageToS3({userId, folder: 'images', dataUrl})
        → users/{userId}/images/{uuid}/original.{ext}
        → users/{userId}/images/{uuid}/thumb.webp (sharp: 360px WebP 55)
    → INSERT images (status: 'draft')
    → PATCH image_drafts (current_image_id, image_url)
    → Retorna signed URL (1h)
→ [Imagem exibida no workspace]
→ [Usuário aprova] → UPDATE images SET status = 'approved'
→ [Imagem aparece na galeria]
```

**Resultado:** imagem salva em `images` com path e URLs. Thumbnail gerado server-side. Imagem **não** está em `library_files`.

---

### Fluxo B: Upload manual (Posts)

```
[Usuário seleciona arquivo] → createThumbnail(file) [cliente]
    → PUT /api/storage/presign-image-upload
    → Recebe: uploadUrl (PUT presigned 15min), imageUrl, storagePath
    → PUT direto no S3 (cliente → bucket)
    → createThumbnail(thumbBlob) → PUT thumbnail no S3
→ PATCH /api/posts {imageUrl, thumbnailUrl, storagePath, ...}
    → UPDATE posts SET image_url=..., post_images=[...]
```

**Resultado:** arquivo em S3 com path `users/{userId}/posts/{uuid}/`. Dados salvos em `posts.post_images` JSONB. Sem entrada em `images` ou `library_files`.

---

### Fluxo C: Upload para Biblioteca

```
[Usuário seleciona arquivo] → POST /api/storage/presign-image-upload {folder: 'library'}
    → Recebe: uploadUrl, imageUrl, storagePath
    → PUT direto no S3 (cliente → bucket)
→ POST /api/library-files {storagePath, publicUrl, name, kind, ...}
    → INSERT library_files
```

**Resultado:** arquivo em `library_files`, path `users/{userId}/library/{prefix}/{uuid}/{nome}.{ext}`. Não passa por `images`.

---

### Resumo de Paths S3

```
users/{userId}/images/{uuid}/original.{ext}    ← geradas por IA
users/{userId}/images/{uuid}/thumb.webp        ← thumbnail de imagem AI
users/{userId}/posts/{uuid}/original.{ext}     ← upload para posts
users/{userId}/posts/{uuid}/thumb.webp         ← thumbnail de post
users/{userId}/library/{prefix}/{uuid}/{name}  ← biblioteca
users/{userId}/library/{prefix}/.keep          ← placeholder de pasta
```

---

## 4. Diagrama Textual das Relações Atuais

```
auth.users
    │
    ├─ projects (1:N)
    │      │
    │      ├─ images (N, project_id nullable, ON DELETE SET NULL)
    │      │     └─ StoredFile: users/{uid}/images/{uuid}/
    │      │
    │      ├─ library_files (N, project_id nullable, ON DELETE SET NULL)
    │      │     └─ StoredFile: users/{uid}/library/{prefix}/{uuid}/
    │      │
    │      └─ library_folders (N)
    │
    ├─ productions (N, via projects)
    │      │
    │      ├─ image_drafts (N, production_id nullable, ON DELETE SET NULL)
    │      │     └─ current_image_id → images (nullable)
    │      │     └─ image_url (cópia da URL, redundante)
    │      │
    │      ├─ video_drafts (N, production_id nullable, ON DELETE SET NULL)
    │      │     └─ scenes[].image_url (embedded JSONB, sem FK)
    │      │
    │      ├─ editorial_contents (N, production_id nullable, ON DELETE SET NULL)
    │      │     └─ channel_pieces (N, ON DELETE CASCADE)
    │      │           [LACUNA: sem mídia]
    │      │
    │      └─ posts (N, production_id nullable, ON DELETE SET NULL)
    │            └─ image_url / storage_path (imagem principal)
    │            └─ post_images JSONB (imagens adicionais — sem FK)
    │
    └─ posts (sem production_id também)
```

---

## 5. Auditoria Detalhada de `post_images`

### Schema real

```sql
-- posts.post_images: JSONB DEFAULT '[]'::jsonb
-- Sem tabela, sem FK, sem RLS própria (herdada do post pai)
```

### Formato de cada item

```typescript
{
  id: string          // UUID gerado no cliente (não é ID do banco)
  imageUrl: string    // URL pública ou signed
  thumbnailUrl: string
  storageProvider: string | null  // 's3' ou null
  storagePath: string | null      // path no S3
  thumbnailPath: string | null
  fileSize: number | null
  mimeType: string | null
  name?: string | null            // nome do arquivo original
}
```

### Análise de limitações

| Dimensão | Estado atual | Problema |
|----------|-------------|---------|
| Integridade | Nenhuma FK | Arquivo pode ser deletado no S3 sem afetar o JSON |
| Ordenação | Índice do array JSON | Reordenar = reescrever o array inteiro |
| Limite | Nenhum | Sem cap definido |
| Tipos MIME | Qualquer string | Sem validação |
| Capa/principal | Primeiro item do array (convencional) | Não há campo `role` |
| Alt text | Ausente | Sem acessibilidade |
| Rastreabilidade | Nenhuma | Não é possível saber se o arquivo veio de `images` ou de upload direto |
| Exclusão do Post | Cascade lógica (JSONB some) | Objetos S3 ficam órfãos |
| Exclusão de arquivo | Nenhuma ação | Referências ficam stale |
| Reutilização | Impossível formalizar | Não há FK — cópia de URL é o único mecanismo |

### O que pode ser reutilizado

- A lógica de `createThumbnail` do cliente (canvas WebP 360px/0.55) pode ser reutilizada
- O fluxo de presigned upload pode ser reutilizado
- Os paths S3 existentes em `posts` podem ser migrados como `storage_path` em `channel_piece_media` sem re-upload

### O que deve ser substituído

- O JSONB embeddado deve ser substituído por uma tabela com FK real
- A ordenação por índice deve ser substituída por campo `position`
- A ausência de `role` deve ser corrigida com campo específico

---

## 6. Alternativas de Modelo

### Alternativa A — JSONB em `channel_pieces.media`

Acrescentar um campo `media jsonb DEFAULT '[]'` à tabela `channel_pieces`.

**Simplicidade:** máxima — sem nova tabela, sem migration complexa  
**Integridade:** zero — sem FK, sem constraint de existência  
**Ordenação:** índice do array — muda com reescrita completa  
**Queries:** não é possível filtrar por `image_id` ou indexar campos do JSONB sem índices GIN  
**Reutilização:** impossível formalizar (a imagem existe em S3, mas sem link formal)  
**Exclusão:** como em `post_images` — objetos S3 ficam órfãos  
**Migração:** trivial — dados de `post_images` entram diretamente  
**Escalabilidade:** ruim — sem estrutura, sem evolução incremental  
**Diagnóstico:** replica os problemas de `post_images`. Adequado apenas para prova de conceito.

---

### Alternativa B — Tabela `channel_piece_media` com FKs separados ✓ Adotada

Nova tabela de associação com FKs tipadas. **Schema final aprovado em CPM-D2 Rev.2:**

```
channel_piece_media
├── id                  uuid PK
├── user_id             uuid NOT NULL FK → auth.users CASCADE
├── channel_piece_id    uuid NOT NULL FK → channel_pieces CASCADE
├── image_id            uuid nullable FK → images ON DELETE RESTRICT
├── library_file_id     uuid nullable FK → library_files ON DELETE RESTRICT
├── position            smallint NOT NULL DEFAULT 0 CHECK (>= 0)
├── role                text NOT NULL DEFAULT 'primary'
│                         CHECK ('primary','thumbnail','carousel_item',
│                                'background','attachment')
├── alt_text            text nullable CHECK (char_length <= 1000)
├── created_at          timestamptz NOT NULL
└── updated_at          timestamptz NOT NULL
CONSTRAINT cpm_exactly_one_source:
  ((image_id IS NOT NULL)::int + (library_file_id IS NOT NULL)::int) = 1
```

**Campos removidos da exploração inicial:** `storage_path`, `storage_provider`, `image_url`, `thumbnail_url`, `file_size`, `mime_type`, `media_kind` — deriváveis via JOIN; URLs resolvidas em runtime (CPM-D19, CPM-D20).

**Mudança de ON DELETE:** RESTRICT (não SET NULL) — compatível com `cpm_exactly_one_source`; impede exclusão de arquivo em uso (CPM-D3).

**Cardinalidade:** exatamente uma fonte por registro; N registros por ChannelPiece  
**Integridade:** FK real para ambas as fontes; RESTRICT previne exclusão não intencional  
**Reutilização:** mesma imagem referenciada por múltiplas CPs sem cópia de storage  
**Ordenação:** `position` explícito; reordenação atualiza inteiros, não reescreve array  
**Capa:** `role = 'primary'`  
**Carrossel:** múltiplos `role = 'carousel_item'` por `position`  
**Vídeo:** `library_file_id` onde `library_files.kind = 'video'`  
**Exclusão de ChannelPiece:** CASCADE remove vínculos, não os arquivos  
**Exclusão de Image/LibraryFile:** RESTRICT — bloqueia se referenciada  
**RLS:** ownership duplo em INSERT e UPDATE (CPM-D11)  
**Diagnóstico:** modelo correto e aprovado.

---

### Alternativa C — Mídia sempre baseada em `library_files`

Toda mídia publicável deve primeiro existir em `library_files`. `ChannelPiece` referencia apenas `library_file_id`.

**Upload direto na versão:** requer criação automática de `LibraryFile` durante o upload — adiciona complexidade  
**Imagens geradas por IA:** exige "promoção" da imagem de `images` para `library_files` — duplica registros ou exige unificação de schema  
**Vídeos:** `library_files.kind = 'video'` já suporta — coerente  
**Arquivos não organizados:** força o usuário a organizar em pastas antes de publicar — atrito desnecessário  
**Custo de migração:** exige criação de `LibraryFile` para cada `post_images` legado — re-upload ou cópia de metadados  
**Duplicação:** a imagem existe em `images` e precisaria de um equivalente em `library_files` — gestão dupla  
**UX:** mais organizado para arquivos gerenciados, mas cria fricção no fluxo de usar imagens geradas  
**Diagnóstico:** válido a longo prazo quando o conceito de "Asset unificado" (ver `DOMAIN_EVOLUTION.md`) for implementado. Prematuro agora.

---

### Alternativa D — Modelo híbrido

Tabela `channel_piece_media` com `library_file_id` como referência preferencial, mas suporte a `image_id` e `storage_path` como fallback para imagens geradas e legados.

**Diagnóstico:** é essencialmente a Alternativa B descrita acima. O "híbrido" está nas FKs separadas — `image_id` para geradas, `library_file_id` para biblioteca, `storage_path` para legado.

---

## 7. Mapa do Fluxo de Post (modelo legado)

```
[Usuário abre /posts]
    → Seleciona projeto, canal, formato
    → Preenche nome, descrição, ai_context
    → Clica "Gerar texto" → POST /api/posts/generate-feed-text
        → OpenAI gpt-4o-mini → feed_text
    → Faz upload de imagem:
        → POST /api/storage/presign-image-upload
        → PUT arquivo → S3 (cliente direto)
        → (opcional) PUT thumbnail → S3 (cliente, canvas)
        → PATCH /api/posts {imageUrl, storagePath, thumbnailUrl, ...}
    → Adiciona imagens adicionais → push para post_images array
    → "Salvar" → PATCH /api/posts {status: 'saved'}
```

### Estado dos dados de smoke test em Posts

Os IDs identificados no briefing como prováveis registros de teste:

```text
posts: 7aa6b5a4, 7eb9ccf4, d02a9507
```

Estes registros **não devem ser deletados** nesta fase. São úteis para validar a migração futura.

---

## 8. Lacunas Identificadas

| Lacuna | Impacto |
|--------|---------|
| `ChannelPiece` sem nenhum campo de mídia | Posts legados não podem ser aposentados |
| `post_images` sem FK para `images` ou `library_files` | Sem rastreabilidade, risco de órfãos |
| Imagens geradas não podem ser referenciadas por `ChannelPiece` | Fluxo: "gerei uma imagem, quero usar no conteúdo" não existe |
| Arquivos da biblioteca não podem ser associados a `ChannelPiece` | Biblioteca desconectada da publicação |
| `video_drafts` não tem arquivo físico | Vídeo real não implementado — qualquer suporte a vídeo em CP deve ser via `library_files` |
| Nenhum cleanup automático de S3 | Objetos ficam órfãos ao deletar Posts ou Images |
| Thumbnails de `library_files` sem geração server-side padronizada | Inconsistência com o padrão de `images` |

---

## 9. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Objetos S3 órfãos ao migrar posts | Alta | Médio | Migrar `storage_path` sem deletar S3; criar jobs de auditoria |
| Posts com `project_id = null` | Média | Alto | Exige decisão: criar EC sem projeto (violação de NOT NULL) ou criar projeto padrão |
| Posts com `post_images` não-vazios | Alta (muito provável) | Alto | Migrar cada item como registro de `channel_piece_media` |
| Imagens aprovadas já referenciadas em múltiplos posts (via URL) | Baixa | Médio | Referência por `image_id` é idempotente — sem risco de duplicação |
| `library_files` deletados (hard-delete) durante migração | Baixa | Médio | ON DELETE SET NULL em FK preserva o registro de mídia mesmo sem a referência |
| FK `image_id` quebrada se `images` for limpa | Média | Médio | ON DELETE SET NULL preserva o registro, `storage_path` serve como fallback |

---

## 10. Questões em Aberto que Exigem Decisão Humana

1. Uma imagem gerada deve ser referenciada diretamente por `channel_piece_media.image_id`, ou deve primeiro ser "promovida" para `library_files`?
2. O upload de nova mídia direto em uma `ChannelPiece` deve criar automaticamente um `LibraryFile`, ou apenas um registro de `channel_piece_media` sem `library_file_id`?
3. Quando um arquivo de biblioteca é deletado (soft ou hard), a mídia associada na `ChannelPiece` deve: (a) manter o registro com `library_file_id = null`, (b) ser deletada junto, ou (c) bloquear a exclusão do arquivo?
4. Qual o limite máximo de mídias por `ChannelPiece`? (Instagram carousel: 10; YouTube: nenhum; WhatsApp: varia)
5. Posts com `project_id = null` — o que fazer? Esses posts violam `EditorialContent.project_id NOT NULL`.
6. Crop/aspect ratio por canal devem ser armazenados por `channel_piece_media`? (ex: 4:5 para Instagram feed, 9:16 para Story)
7. Thumbnails de vídeos em `library_files` devem ser gerados automaticamente server-side?

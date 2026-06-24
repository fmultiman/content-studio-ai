# Posts — Discovery de Migração (M8)
**Data:** 2026-06-24  
**Branch:** `discovery/posts-to-editorial-content-m8`  
**Status:** Somente leitura — nenhum dado alterado.  
**Escopo:** Inventário completo, auditoria de mídia, dependências ativas, classificação de migrabilidade.

---

## 1. Inventário Integral

### 1.1 Total de Posts

| Métrica | Valor |
|---------|-------|
| Total de registros | **4** |
| Usuários distintos | 1 |
| Projetos distintos | 1 (`d0d008c3` — Content Agent) |
| Productions distintas | 1 (`492af729` — "Teste publicação 01") |
| Com `project_id` | 3 |
| Com `project_id = NULL` | **1** |
| Com `production_id` | 4 |
| Com `production_id = NULL` | 0 |
| Com canal definido | 4 |
| Com `description` | 4 |
| Com `feed_text` | 1 |
| Com `image_url` | 1 |
| Com `post_images` (≥ 1 item) | 1 |
| Com status `saved` | 4 |
| Com status `draft` | 0 |

### 1.2 Registros detalhados

| # | id | name | channel | project_id | production_id | status | mídias |
|---|----|----- |---------|------------|---------------|--------|--------|
| P1 | `d02a9507` | Teste Post Smoke Test 01 | `instagram_post` | `d0d008c3` | `492af729` | saved | 1 PNG (S3) |
| P2 | `7eb9ccf4` | outro teste de post | `youtube_post` | `d0d008c3` | `492af729` | saved | 0 |
| P3 | `083a69d5` | outro teste de story | `instagram_story` | **NULL** | `492af729` | saved | 0 |
| P4 | `7aa6b5a4` | teste 04 | `youtube_video` | `d0d008c3` | `492af729` | saved | 0 |

### 1.3 Contexto da Production

Production `492af729` ("Teste publicação 01"):
- `project_id`: `d0d008c3` (Content Agent)
- Ainda existe no banco — não foi deletada
- Todos os 4 posts estão vinculados a ela

### 1.4 Natureza dos Posts

**Todos os 4 posts são registros de smoke/teste:**
- Criados em 2026-06-23 (mesmo dia da implantação M1–M6)
- Nomes explícitos: "Smoke Test 01", "outro teste de post", "outro teste de story", "teste 04"
- Production de origem: "Teste publicação 01"
- Nenhum conteúdo editorial real ou de negócio identificado

Não há Posts de usuário final (real) na base de produção.

---

## 2. Auditoria de Mídias em `post_images`

### 2.1 Inventário de mídias

| Post | Posição | Nome | MIME | Tamanho | Storage Key | Em `images`? | Em `library_files`? |
|------|---------|------|------|---------|-------------|-------------|---------------------|
| P1 (`d02a9507`) | 0 | Content Agent Studio — Future Vision Concept.png | image/png | 1.293.601 bytes (~1,2 MB) | `users/35428fd4.../posts/3f142fc2.../Content-Agent-Studio-Future-Vision-Concept.png` | ❌ | ❌ |

**Thumbnail gerado automaticamente:**  
`users/35428fd4.../posts/b8de9c78.../Content-Agent-Studio-Future-Vision-Concept-thumb.webp`

### 2.2 Classificação da mídia

| Item | Classificação | Motivo |
|------|--------------|--------|
| P1 — imagem PNG | **EXIGE IMPORTAÇÃO PARA `library_files`** | Arquivo físico em S3 (pasta `posts/`) sem registro em nenhuma tabela de rastreabilidade. Não existe em `images` nem em `library_files`. Para migrar como `ChannelPieceMedia`, precisa de um `library_file` correspondente. |
| P1 — thumbnail WebP | **EXIGE DECISÃO** | Pode ser descartado (thumbnail regenerável) ou importado como recurso secundário. Recomendação: descartar — regenerar via `ChannelPieceMedia` se necessário. |

### 2.3 Acessibilidade

A URL da imagem está em S3 interno (`s3.multihuman.com.br/content-studio/...`).  
Acessibilidade física: presume-se OK (arquivo foi upado pelo smoke test M1/M6 no mesmo dia, sem operação de cleanup nessa pasta). Não verificado com HEAD request nesta etapa.

### 2.4 Origem da mídia

A imagem foi enviada via `POST /api/storage/presign-image-upload` com `folder: 'posts'`.  
O path segue o padrão: `users/<user_id>/posts/<uuid>/<filename>`.  
**Não há FK para nenhuma tabela de media** — o caminho existe só no JSONB de `posts.post_images`.

---

## 3. Dependências Ativas do Domínio Antigo

### 3.1 Mapa de dependências

| Arquivo | Rota/Componente | Tipo de uso | Pode remover pós-migração? |
|---------|----------------|-------------|---------------------------|
| `app/api/posts/route.ts` | `GET/POST/PATCH/DELETE /api/posts` | CRUD completo — leitura, criação, edição, exclusão | Sim — após migrar todos os Posts e atualizar dependentes |
| `app/api/posts/generate-feed-text/route.ts` | `POST /api/posts/generate-feed-text` | Geração de texto IA | Sim — lógica pode ser migrada para futura rota de ChannelPiece |
| `app/(dashboard)/posts/page.tsx` | `/posts` | UI completa — lista, editor, upload de imagens | Sim — substituir por `/publicacoes` quando migração concluída |
| `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` | Aba "Posts legados" | Leitura de `GET /api/posts?productionId=...` + navegação para `/posts` | Sim — remover aba após migração (substituir por EditorialContents) |
| `app/(dashboard)/conteudos/page.tsx` | Seção "Posts legados" | Link para `/posts` | Sim — remover link pós-migração |
| `lib/types.ts` | `Post`, `PostImage`, `PublicationType`, `PostStatus` | Tipos de domínio | Sim — remover após migração e remoção da API |
| `lib/supabase/middleware.ts` | Proteção de rota | `/posts` como rota protegida | Sim — remover rota da lista pós-deprecação |
| `lib/storage/s3.ts` | Função de presign | Aceita `folder: 'posts'` como destino válido | Sim — remover após migração |
| `app/api/storage/presign-image-upload/route.ts` | `POST /api/storage/presign-image-upload` | Aceita `folder: 'posts'` | Sim — remover suporte ao folder após migração |
| `app/api/storage/upload-image/route.ts` | Upload direto | Aceita `folder: 'posts'` | Sim — remover suporte ao folder após migração |
| `scripts/012_create_posts.sql` | DDL | Schema da tabela `posts` | Manter para histórico — nunca re-executar |
| `scripts/013_add_storage_metadata.sql` | DDL | Adiciona campos de storage a `posts` | Manter para histórico |
| `scripts/014_add_post_images.sql` | DDL | Adiciona coluna `post_images` JSONB | Manter para histórico |
| `scripts/020_create_productions.sql` | DDL | Referencia `posts` via `production_id` | Verificar FKs antes de DROP |

### 3.2 Dependências funcionais críticas

**Aba "Posts legados" na Production:**  
`/projetos/[id]/producoes/[productionId]/page.tsx` carrega posts da API e os exibe.  
Esta aba deve permanecer até que os Posts sejam migrados — remover antes cria UX quebrada.

**`/posts` como rota protegida:**  
Se a rota for removida antes de migrar os Posts, o usuário perde acesso ao único editor dos posts legados.

**`lib/storage/s3.ts` — folder `posts`:**  
O upload de imagens para Posts novos usa este folder. Após a migration, nenhum novo Post deve ser criado — mas o código ainda aceita. A remoção do suporte ao folder deve ser coordenada com a desativação da UI de criação.

---

## 4. Schema da Tabela `posts`

```sql
posts (
  id              UUID PK
  user_id         UUID NOT NULL → auth.users CASCADE
  project_id      UUID nullable → projects ON DELETE SET NULL
  production_id   UUID nullable → productions ON DELETE SET NULL
  name            TEXT NOT NULL
  channel         TEXT NOT NULL CHECK (instagram_post|instagram_story|youtube_post|youtube_shorts|youtube_video)
  description     TEXT nullable
  ai_context      TEXT nullable
  feed_text       TEXT nullable
  image_url       TEXT nullable       -- URL direta S3, sem FK
  thumbnail_url   TEXT nullable
  storage_provider TEXT nullable
  storage_path    TEXT nullable
  thumbnail_path  TEXT nullable
  file_size       INTEGER nullable
  mime_type       TEXT nullable
  post_images     JSONB DEFAULT '[]'  -- array de PostImage, sem FK
  status          TEXT CHECK (draft|saved)
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
)
```

RLS ativa: `user_id = auth.uid()` para SELECT, INSERT, UPDATE, DELETE.

---

## 5. Classificação de Migrabilidade

| Post | id | Classificação | Flags adicionais | Motivo |
|------|----|--------------|-----------------|--------|
| P1 | `d02a9507` | `MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA` | `SMOKE/TESTE` | Tem project_id, production_id, channel válido. Mas a 1 imagem não está em `library_files` — exige importação antes de criar `ChannelPieceMedia`. |
| P2 | `7eb9ccf4` | `AUTO_MIGRÁVEL` | `SMOKE/TESTE` | Tem project_id, production_id, channel válido. Sem mídia. Pode ser migrado diretamente. |
| P3 | `083a69d5` | `EXIGE ATRIBUIÇÃO DE PROJETO` | `SMOKE/TESTE` | `project_id = NULL`. Bloqueador formal para auto-migração. Projeto inferível com alta confiança via `production.project_id = d0d008c3`. Requer confirmação humana antes de migrar. |
| P4 | `7aa6b5a4` | `AUTO_MIGRÁVEL` | `SMOKE/TESTE` | Tem project_id, production_id, channel válido. Sem mídia. Pode ser migrado diretamente. |

### 5.1 Resumo por categoria

| Categoria | Quantidade |
|-----------|-----------|
| `AUTO_MIGRÁVEL` | 2 |
| `MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA` | 1 |
| `EXIGE ATRIBUIÇÃO DE PROJETO` | 1 |
| `BLOQUEADO POR MÍDIA ÓRFÃ` | 0 |
| `INDETERMINADO` | 0 |
| `NÃO DEVE SER MIGRADO` | 0 |

---

## 6. Posts com `project_id = NULL`

**Quantidade:** 1 (Post P3 — `083a69d5` — "outro teste de story")

**Análise:**
- Production vinculada (`492af729`) tem `project_id = d0d008c3` (Content Agent)
- O Post foi criado com `project_id = null` — provavelmente erro na UI: ao criar o Post dentro da Production, o `projectId` não foi transmitido
- **Projeto provável:** `d0d008c3` (Content Agent) — confiança: **ALTA** (única evidência disponível é a production vinculada, que pertence a esse projeto)
- **Decision necessária:** confirmação humana antes de atribuir `project_id`

---

## 7. Riscos Identificados

| Risco | Severidade | Detalhe |
|-------|-----------|---------|
| Mídia de P1 não rastreada | Médio | Imagem em `posts/` não existe em `images` nem `library_files`. Se for migrar como `ChannelPieceMedia`, precisa de importação explícita. |
| Post P3 sem `project_id` | Médio | `EditorialContent.project_id` é NOT NULL. Não pode ser auto-migrado. Inferência disponível mas exige confirmação. |
| Todos os Posts são de teste | Baixo | Nenhum conteúdo editorial real. Reduz risco de perda de dados relevantes. Aumenta possibilidade de opção "NÃO DEVE SER MIGRADO" após decisão humana. |
| Production e projeto ainda existem | Baixo-positivo | Nenhum referente foi deletado. Migration tem destino válido. |
| S3 folder `posts/` não é gerenciado | Médio | Arquivos de `posts/` não têm `library_file` correspondente. Sem cleanup automático ao deletar post. Risco de objetos órfãos persistindo no storage. |

---

*Documento produzido em discovery M8 — 2026-06-24. Somente leitura. Nenhum dado foi alterado.*

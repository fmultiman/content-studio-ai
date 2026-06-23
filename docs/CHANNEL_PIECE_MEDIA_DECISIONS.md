# ChannelPiece Media — Decisões de Domínio
**Data:** 2026-06-22  
**Status:** Proposta. Requer aprovação explícita antes de qualquer implementação.

> Este documento converte o mapeamento de `CHANNEL_PIECE_MEDIA_DISCOVERY.md` em decisões formais.  
> Cada decisão tem código `CPM-D*`, contexto, decisão recomendada, razão, alternativas rejeitadas e consequências.

---

## Como ler

As decisões são propostas derivadas da descoberta. Antes de implementar qualquer incremento de `CHANNEL_PIECE_MEDIA_IMPLEMENTATION_PLAN.md`, cada decisão relevante deve ser confirmada ou revisada explicitamente.

Questões que exigem resposta humana são marcadas com **[ABERTA]**.

---

## CPM-D1 — Modelo de persistência de mídia

**Contexto:** A mídia de `ChannelPiece` pode ser representada como JSONB dentro de `channel_pieces` (Alternativa A) ou como tabela separada `channel_piece_media` (Alternativa B).

**Decisão recomendada:** Tabela `channel_piece_media` com FKs separados (`image_id`, `library_file_id`).

**Razão:** JSONB replica os problemas já identificados em `post_images`: sem FK, sem integridade, sem ordenação formal, sem rastreabilidade. Uma tabela separada permite integridade referencial, ordering via `position`, role via campo dedicado, e evolução incremental. A descoberta confirmou que `post_images` tem zero mecanismos de integridade — reproduzir esse padrão em `ChannelPiece` seria dívida técnica deliberada.

**Alternativas rejeitadas:**
- A (JSONB): não oferece integridade, não evolui bem, replica o problema de `post_images`
- C (apenas `library_files`): requer promoção obrigatória de imagens geradas para biblioteca — atrito desnecessário antes do conceito de Asset unificado
- D (polimórfico `asset_kind` + `asset_id`): sem FK real — o banco não pode garantir integridade referencial

**Consequências:** nova tabela, nova API, novo índice. Suporte incremental permite começar com funcionalidade básica.

---

## CPM-D2 — Schema da tabela `channel_piece_media`

**Contexto:** A tabela precisa suportar imagens de `images`, arquivos de `library_files`, e dados legados de `post_images` (que têm `storage_path` mas sem FK).

**Decisão recomendada:**

```sql
channel_piece_media (
  id                 uuid PK DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_piece_id   uuid NOT NULL REFERENCES channel_pieces(id) ON DELETE CASCADE,
  image_id           uuid REFERENCES images(id) ON DELETE SET NULL,
  library_file_id    uuid REFERENCES library_files(id) ON DELETE SET NULL,
  storage_path       text,
  storage_provider   text,
  image_url          text,
  thumbnail_url      text,
  file_size          integer,
  mime_type          text,
  media_kind         text NOT NULL DEFAULT 'image'
                       CHECK (media_kind IN ('image','video','document','other')),
  position           smallint NOT NULL DEFAULT 0,
  role               text NOT NULL DEFAULT 'primary'
                       CHECK (role IN ('primary','thumbnail','carousel_item',
                                       'background','attachment')),
  alt_text           text,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT cpm_has_source
    CHECK (image_id IS NOT NULL
        OR library_file_id IS NOT NULL
        OR storage_path IS NOT NULL)
)
```

**Razão:** 
- `image_id` e `library_file_id` são FKs reais — o banco impõe integridade
- ON DELETE SET NULL preserva o registro mesmo se o arquivo source sumisse — sem perda silenciosa de dados
- `storage_path` fallback permite migrar `post_images` sem re-upload
- `CONSTRAINT cpm_has_source` garante que pelo menos uma fonte existe
- `position` permite ordenação sem reescrita do array
- `role` permite carrossel, thumbnail, capa e background como casos distintos

**Consequências:** exige migration, RLS, índices.

---

## CPM-D3 — FK com ON DELETE SET NULL (não CASCADE) para sources

**Contexto:** Quando uma `Image` ou `LibraryFile` é deletada, o que acontece com `channel_piece_media`?

**Decisão recomendada:** ON DELETE SET NULL em `image_id` e `library_file_id`.

**Razão:** A exclusão de um arquivo não deve destruir silenciosamente o histórico da `ChannelPiece`. O registro de mídia permanece (com FKs nulas e `storage_path` possivelmente stale), permitindo:
- Auditoria pós-exclusão
- UI indicar "mídia removida" ao invés de sumir sem aviso
- Rollback mais seguro

O `CONSTRAINT cpm_has_source` pode ser relaxado para migração de legados onde só `image_url` existe (sem `storage_path`). Decidir em CPM-D10.

**Alternativas rejeitadas:**
- ON DELETE CASCADE: destrói silenciosamente registros de mídia ao deletar qualquer arquivo — risco de perda de dados
- Bloquear exclusão de arquivo (RESTRICT): impede o usuário de limpar biblioteca se qualquer arquivo estiver em uso — UX ruim

**Consequências:** a UI deve detectar registros com `image_id = null AND library_file_id = null AND storage_path IS NULL` e exibir estado "mídia não disponível".

---

## CPM-D4 — CASCADE de `ChannelPiece` para `channel_piece_media`

**Contexto:** Quando uma `ChannelPiece` é deletada, o que acontece com seus registros de mídia?

**Decisão recomendada:** ON DELETE CASCADE em `channel_piece_id`.

**Razão:** Uma mídia de `channel_piece_media` não tem identidade sem seu `ChannelPiece`. A associação é dependente: a mídia existe para servir a peça de canal. Deletar a peça deve deletar o vínculo — mas NÃO o arquivo físico (ver CPM-D3). O arquivo em S3 permanece; apenas o registro de associação some.

**Consequências:** Ao deletar `ChannelPiece`, todos os registros `channel_piece_media` são removidos. Os arquivos em `images` e `library_files` sobrevivem.

---

## CPM-D5 — Referência vs Cópia de mídia

**Contexto:** Ao associar uma imagem a uma `ChannelPiece`, deve-se copiar o arquivo no S3 ou apenas referenciar?

**Decisão recomendada:** Referência — sem cópia de arquivo.

**Razão:** 
- Cópia desperdiça storage e complica exclusão (qual das cópias é "a original"?)
- A referência via `image_id` ou `library_file_id` é suficiente para integridade e rastreabilidade
- Se a imagem precisar de crop/ajuste para o canal, isso deve ser um campo de metadados, não uma cópia física

**Consequências:** a mesma imagem pode ser referenciada por múltiplas `ChannelPiece`s sem overhead de storage.

---

## CPM-D6 — Imagens geradas por IA: referenciadas diretamente via `image_id`

**Contexto:** Uma imagem aprovada em `images` (gerada por IA) pode ser associada a uma `ChannelPiece`. Ela deve ser promovida para `library_files` primeiro, ou referenciada diretamente?

**Decisão recomendada:** Referenciada diretamente via `image_id` — sem promoção obrigatória.

**Razão:**
- A promoção para `library_files` é um passo adicional que não agrega valor imediato
- O conceito de "Asset unificado" (`DOMAIN_EVOLUTION.md` Fase A) — onde `images` e `library_files` convergem — está adiado
- Forçar promoção antes desse conceito existir cria trabalho manual desnecessário para o usuário
- `image_id` como FK direta é suficiente para integridade

**[ABERTA]** Quando `DOMAIN_EVOLUTION.md` Fase A for implementada (Asset unificado), revisar se `image_id` deve ser migrado para `library_file_id` ou se `channel_piece_media` suporta ambos permanentemente.

---

## CPM-D7 — Limite de mídias por `ChannelPiece`

**Contexto:** Diferentes formatos têm limites distintos (Instagram carousel: máximo 10; YouTube: sem limite para descrições; WhatsApp: variável).

**Decisão recomendada:** Validar limites na API por `channel + format`, sem constraint no banco. Limite defensivo de 20 no banco via CHECK no `position`.

**Razão:** O banco não conhece `channel + format` da `ChannelPiece` no contexto de inserção em `channel_piece_media`. A validação de negócio (máx 10 para `instagram + carousel`) pertence à camada de API. Um limite defensivo de 20 `position` protege contra abusos sem bloquear casos legítimos futuros.

**Consequências:** API de inserção deve validar contagem de mídias antes de inserir. Documentar limites por canal em `lib/publication-channels.ts`.

---

## CPM-D8 — Ordenação e capa

**Contexto:** Em um carrossel, a ordem das imagens importa. A imagem principal (capa) deve ser identificável.

**Decisão recomendada:**
- `position` define a ordem (0 = primeira, 1 = segunda, etc.)
- `role = 'primary'` identifica a imagem de capa/destaque
- Para carrossel: todos os itens têm `role = 'carousel_item'`, exceto a capa que pode ter `role = 'primary'`
- Para formatos single-image: única mídia com `role = 'primary'`

**Razão:** Dois mecanismos distintos para duas perguntas distintas: "em que ordem aparecem?" (`position`) e "qual é a principal?" (`role`). Isso permite, por exemplo, uma capa separada das imagens do carrossel.

**Consequências:** A UI de reordenação deve atualizar `position` de todos os itens afetados em uma transação.

---

## CPM-D9 — Thumbnails

**Contexto:** Thumbnails existem para imagens em `images` (gerados server-side por `sharp`) e podem existir para `library_files`. Como `channel_piece_media` lida com thumbnails?

**Decisão recomendada:**
- `channel_piece_media.thumbnail_url` guarda a URL do thumbnail, derivada da fonte
- Para `image_id`: usar `images.thumbnail_url` — já existe, já é gerado server-side
- Para `library_file_id`: usar `library_files.thumbnail_url` — gerado no upload se disponível
- Para `storage_path` (migração): preservar `thumbnail_url` do `PostImage` legado
- Thumbnails não são gerados novamente em `channel_piece_media` — são referências às fontes

**Razão:** Evitar duplicação de storage e lógica. O thumbnail já existe na entidade de origem.

**Consequências:** A UI deve preferir `channel_piece_media.thumbnail_url`; se ausente, buscar em `image_id.thumbnail_url` ou `library_file_id.thumbnail_url`.

---

## CPM-D10 — Constraint `cpm_has_source` e caso legacy

**Contexto:** A constraint `CHECK (image_id IS NOT NULL OR library_file_id IS NOT NULL OR storage_path IS NOT NULL)` garante pelo menos uma fonte. Mas `PostImage` legados só têm `imageUrl` (URL pública) sem `storage_path` confirmado.

**Decisão recomendada:** Relaxar `cpm_has_source` para incluir `image_url`:

```sql
CONSTRAINT cpm_has_source
  CHECK (image_id IS NOT NULL
      OR library_file_id IS NOT NULL
      OR storage_path IS NOT NULL
      OR image_url IS NOT NULL)
```

**Razão:** A migração de `post_images` legados pode ter apenas `imageUrl` sem `storagePath`. Bloquear esses registros forçaria re-upload ou perda de dados. Após a migração, novos registros nunca devem ter apenas `image_url` — validar isso na API.

**Consequências:** API deve rejeitar criação nova com apenas `image_url` (sem `storage_path` ou FK). Migração de legados pode usar apenas `image_url`.

---

## CPM-D11 — RLS de `channel_piece_media`

**Contexto:** RLS deve garantir que o usuário só acesse mídias das suas próprias `ChannelPiece`s.

**Decisão recomendada:**

```sql
-- SELECT: vê apenas as próprias mídias
USING (auth.uid() = user_id)

-- INSERT: ownership do usuário + ChannelPiece pertence ao usuário
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM channel_pieces
    WHERE channel_pieces.id = channel_piece_id
      AND channel_pieces.user_id = auth.uid()
  )
)

-- UPDATE: apenas as próprias mídias
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)

-- DELETE: apenas as próprias mídias
USING (auth.uid() = user_id)
```

**Razão:** Padrão idêntico ao de `channel_pieces` — RLS de dupla camada: ownership do usuário + ownership do pai.

**Consequências:** Nenhum acesso cross-user possível via API pública.

---

## CPM-D12 — Validação de Projeto na associação

**Contexto:** Uma mídia de `channel_piece_media` deve pertencer ao mesmo Projeto que a `ChannelPiece`. Como validar isso?

**Decisão recomendada:** Validação na camada de API (não no banco).

**Razão:**
- Para `image_id`: validar que `images.project_id = editorial_content.project_id` na API de INSERT
- Para `library_file_id`: validar que `library_files.project_id = editorial_content.project_id` (ou null — library files sem projeto são aceitáveis)
- O banco não tem como verificar essa regra via FK em uma única constraint
- API já tem acesso ao `project_id` via `channel_piece → editorial_content → project_id`

**Consequências:** A API de criação de `channel_piece_media` deve fazer cross-check de `project_id` antes de inserir.

**[ABERTA]** Imagens sem `project_id` (nullable em `images`) — aceitáveis em `ChannelPiece` de qualquer Projeto? Sugestão: sim, se `images.project_id IS NULL`.

---

## CPM-D13 — Suporte a vídeos

**Contexto:** `video_drafts` não contém arquivo físico de vídeo — apenas storyboard. Como `ChannelPiece` com `format = 'reel'` ou `format = 'short'` suporta vídeo?

**Decisão recomendada:** Vídeos são suportados via `library_file_id` onde `library_files.kind = 'video'`. Não há referência a `video_drafts` em `channel_piece_media`.

**Razão:** `VideoDraft` é planejamento, não arquivo publicável. O arquivo de vídeo real (quando existir) deve ser uploaded para `library_files` com `kind = 'video'`. Formatos `reel` e `short` aceitam `media_kind = 'video'` em `channel_piece_media`.

**[ABERTA]** Quando a geração de vídeo real for implementada, os arquivos resultantes devem ir para `library_files` (sugestão) ou para uma nova tabela `videos`?

---

## CPM-D14 — Mídias externas (URL pública sem storage S3)

**Contexto:** Um usuário pode querer associar uma URL externa (ex: imagem do Unsplash, YouTube embed) a uma `ChannelPiece`.

**Decisão recomendada:** Não suportado no schema inicial. Futuro: campo `external_url` opcional, sem `cpm_has_source` exigindo storage_path.

**Razão:** Adicionar `external_url` no schema inicial cria ambiguidade sobre qual campo usar como fonte. O caso de uso não foi validado com usuários. Manter fora do escopo do M1.

**[ABERTA]** Há caso de uso real de referenciar mídia externa (não própria) em `ChannelPiece`?

---

## CPM-D15 — Crop e aspect ratio por canal

**Contexto:** Instagram feed exige 4:5, Story/Reel exige 9:16. A mesma imagem pode precisar de crops diferentes por canal.

**Decisão recomendada:** Não implementar crop no schema inicial. Futuro: campo `aspect_ratio text` e `crop_metadata jsonb` em `channel_piece_media`.

**Razão:** Crop é uma funcionalidade de UI/processamento complexa. O schema pode receber esses campos em migration futura sem breaking change. Implementar agora sem UI de crop seria especulação.

---

## CPM-D16 — Alt text

**Contexto:** Acessibilidade requer `alt_text` para imagens em plataformas que suportam (Instagram, LinkedIn).

**Decisão recomendada:** Campo `alt_text text nullable` incluído no schema inicial (CPM-D2). Preenchimento opcional pelo usuário.

**Razão:** Campo simples, sem custo de implementação, com valor de acessibilidade imediato. Melhor incluir no schema desde o início do que migrar depois.

---

## CPM-D17 — Estratégia de upload de nova mídia em ChannelPiece

**Contexto:** O usuário faz upload de uma nova imagem diretamente no contexto de uma `ChannelPiece`. Essa imagem deve ir para `images`, `library_files`, ou diretamente para S3 sem entidade?

**Decisão recomendada:** Upload direto para S3 no path `posts/` (compatível com post legado) → registro criado em `channel_piece_media` com `storage_path` + `image_url`, sem `image_id` ou `library_file_id`.

**Razão:**
- Adicionar à biblioteca (`library_files`) pode não ser o que o usuário quer — é um arquivo de trabalho, não necessariamente gerenciado
- Adicionar a `images` não faz sentido semântico — essa tabela é para imagens AI-geradas
- `storage_path` no schema de `channel_piece_media` cobre esse caso
- O usuário pode depois "salvar na biblioteca" como ação explícita separada

**Alternativa para M5:** validar com produto se upload direto deve ou não criar `LibraryFile` automaticamente.

**[ABERTA]** Upload direto na ChannelPiece deve criar uma entrada em `library_files` automaticamente?

---

## CPM-D18 — Estratégia de migração de `post_images`

**Contexto:** Cada `Post` legado deve migrar para `EditorialContent` + `ChannelPiece` + `channel_piece_media`.

**Decisão recomendada:** Mapeamento:

```text
Post.image_url + storage_path → channel_piece_media {role: 'primary', position: 0, storage_path, image_url}
Post.post_images[0] → channel_piece_media {role: 'carousel_item', position: 0, ...}
Post.post_images[1] → channel_piece_media {role: 'carousel_item', position: 1, ...}
...

Post.name          → EditorialContent.title
Post.description   → EditorialContent.body
Post.ai_context    → EditorialContent.ai_context
Post.project_id    → EditorialContent.project_id   [ver CPM-D18a]
Post.production_id → EditorialContent.production_id
Post.channel       → ChannelPiece.channel + format  [ver mapeamento em PUB-D13]
Post.feed_text     → ChannelPiece.body
Post.status = 'saved' → ChannelPiece.status = 'approved'
Post.status = 'draft' → ChannelPiece.status = 'draft'
```

**[CPM-D18a — ABERTA]** Posts com `project_id = null` violam `EditorialContent.project_id NOT NULL`. Opções:
  1. Criar um Projeto especial "Posts sem projeto" e usar como destino
  2. Solicitar ao usuário que associe manualmente ao projeto correto antes da migração
  3. Bloquear esses posts da migração automática (migrar apenas os com `project_id`)

**Consequências:** A migração deve ser idempotente (rodar duas vezes não duplica dados). Adicionar `migrated_post_id uuid` em `editorial_contents` para rastrear origem.

---

## CPM-D19 — Estratégia de aposentadoria de Posts

**Decisão recomendada:** Processo em etapas:

```
M8 — Migrar dados: EC + CP + CPM para cada Post
M9 — Posts read-only: desabilitar criação/edição; exibir banner "Posts legados"
M10 — Remover Posts do menu sidebar e das Production tabs
(fase posterior) — Remover API e tabela
```

**Razão:** Remoção brusca cria risco de perda de dados. Etapas permitem validação em cada ponto.

**Nunca:** deletar a tabela `posts` em produção sem validação humana explícita dos dados migrados.

---

## Registro de Decisões

| Código | Decisão | Status |
|--------|---------|--------|
| CPM-D1 | Tabela separada `channel_piece_media` com FKs (não JSONB) | Recomendada |
| CPM-D2 | Schema de `channel_piece_media` com campos de integridade e metadados | Recomendada |
| CPM-D3 | ON DELETE SET NULL para `image_id` e `library_file_id` | Recomendada |
| CPM-D4 | ON DELETE CASCADE de `channel_piece_id` | Recomendada |
| CPM-D5 | Referência sem cópia de arquivo | Recomendada |
| CPM-D6 | Imagens AI referenciadas diretamente via `image_id` | Recomendada |
| CPM-D7 | Limites de mídia validados na API por canal/formato | Recomendada |
| CPM-D8 | `position` para ordem, `role` para finalidade | Recomendada |
| CPM-D9 | `thumbnail_url` derivado da entidade de origem | Recomendada |
| CPM-D10 | `cpm_has_source` inclui `image_url` para suporte a legados | Recomendada |
| CPM-D11 | RLS: ownership duplo usuário + ChannelPiece pai | Recomendada |
| CPM-D12 | Validação de Projeto na API, não no banco | Recomendada |
| CPM-D13 | Vídeos via `library_file_id` (kind = 'video') | Recomendada |
| CPM-D14 | Mídias externas fora do escopo inicial | Recomendada |
| CPM-D15 | Crop/aspect ratio em fase futura | Recomendada |
| CPM-D16 | `alt_text` no schema inicial, opcional | Recomendada |
| CPM-D17 | Upload direto → S3 `posts/` → `storage_path` em CPM | Recomendada; [ABERTA] |
| CPM-D18 | Mapeamento Post → EC + CP + CPM | Recomendada; [ABERTA CPM-D18a] |
| CPM-D19 | Aposentadoria de Posts em etapas M8→M10 | Recomendada |

**Decisões com `[ABERTA]`:** requerem resposta humana antes de M5 (upload) e M8 (migração).  
Decisões CPM-D1 a CPM-D4 são suficientes para iniciar M1 (schema).

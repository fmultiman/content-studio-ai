# Handoff — Fase de Publicações (P1–P6)
**Data:** 2026-06-22  
**Branch final:** `feat/publication-p6-post-video-flow`  
**Não fazer merge em main sem aprovação explícita.**

---

## O que foi implementado

### Domínio completo de Publicações em 6 incrementos

| Incremento | Branch | Objetivo | Status |
|------------|--------|----------|--------|
| P1 | `feat/publication-p1-schema` | Schema de banco (`editorial_contents` + `channel_pieces`) e tipos TypeScript | ✓ |
| P2 | `feat/publication-p2-api` | APIs CRUD completas com validação e RLS | ✓ |
| P3 | `feat/publication-p3-ui` | Hub `/publicacoes` e workspace de detalhe EC | ✓ |
| P4 | `feat/publication-p4-channel-pieces` | Gestão inline de ChannelPieces + geração por IA | ✓ |
| P5 | `feat/publication-p5-production-quick-flow` | Quick Flow 2 passos (EC→CP) + aba Conteúdos na Production | ✓ |
| P6 | `feat/publication-p6-post-video-flow` | Entry point de publicação no workspace de vídeo | ✓ |

---

## Arquitetura do domínio

### Modelo de dados

```
Project (existente)
  └─ Production (existente)
       ├─ VideoDraft (existente, production_id nullable)
       └─ EditorialContent (novo P1)
            └─ ChannelPiece[] (novo P1)
```

**Sem FK entre `video_drafts` e `editorial_contents`** — relação implícita via `production_id` compartilhado.

### Tabelas criadas (migration `scripts/021_create_publication_entities.sql`)

**`editorial_contents`**
- `id`, `user_id`, `project_id` (FK RESTRICT), `production_id` (FK SET NULL, nullable)
- `title` (NOT NULL), `body`, `ai_context`
- `status`: `draft | ready | archived`
- RLS: `user_id = auth.uid()` em SELECT/INSERT/UPDATE/DELETE

**`channel_pieces`**
- `id`, `user_id`, `editorial_content_id` (FK CASCADE)
- `channel`: `instagram | youtube | linkedin | tiktok | twitter | whatsapp | facebook`
- `format`: depende do canal (validado via `lib/publication-channels.ts`)
- `title`, `body`, `cta`, `hashtags`
- `status`: `draft | ready | approved | archived`
- RLS: `user_id = auth.uid()` em SELECT/INSERT/UPDATE/DELETE

### APIs implementadas

| Rota | Métodos | Notas |
|------|---------|-------|
| `/api/editorial-contents` | GET, POST | filtros: `projectId`, `productionId`, `status`; paginação: `limit` |
| `/api/editorial-contents/[id]` | GET, PATCH, DELETE | PATCH aceita `title`, `body`, `aiContext`, `status`, `projectId`, `productionId` |
| `/api/channel-pieces` | GET, POST | filtros: `editorialContentId`, `productionId`, `channel`, `format`, `status` |
| `/api/channel-pieces/[id]` | GET, PATCH, DELETE | PATCH aceita todos os campos |
| `/api/channel-pieces/generate-body` | POST | Geração via OpenAI `gpt-4o-mini`; usa `user_settings.openai_api_key` ou `OPENAI_API_KEY` env |

Todas as rotas têm:
- Autenticação via `supabase.auth.getUser()`
- Guard `isPlainObject` antes de `Object.keys()` (evita bypass com string/array)
- Whitelist de campos permitidos (`ALLOWED_POST_KEYS`, `ALLOWED_PATCH_KEYS`)
- Validação de ownership (defense in depth além de RLS)

### UI implementada

**`/publicacoes`** — Hub global de publicações
- Lista todos os `EditorialContent`s do usuário
- Filtros: Projeto, Status, Production (client-side quando projeto selecionado)
- Botões: "Novo Conteúdo" + "Publicação rápida" (QuickFlowDialog sem contexto)

**`/projetos/[id]/conteudos/[editorialContentId]`** — Workspace de EC
- Formulário de edição de EC (título, corpo, aiContext, status, projeto, production)
- Seção de ChannelPieces: listar, criar, editar, deletar, gerar body via IA
- Proteção de URL: valida `ec.project_id === params.id`

**Production detail — aba "Conteúdos"**
- Lista ECs vinculados à produção (vista agrupada EC + CPs inline como chips)
- Botões: "Criar Conteúdo" + "Publicação rápida" (QuickFlowDialog com `lockedProjectId` + `lockedProductionId`)

**`/videos`** — Workspace de vídeo
- Botão "Preparar publicação" (Zap) ao lado de "Gerar Vídeo"
- Abre `QuickFlowDialog` com contexto pré-preenchido do `VideoDraft`
- Desabilitado quando não há nome de vídeo e sem cenas

### Componentes criados

**`components/publication/quick-flow-dialog.tsx`**
- Dialog 2 passos: Passo 1 (EC) → Passo 2 (CP)
- Props de lock: `lockedProjectId`, `lockedProductionId` — ocultam os selects
- Props de pré-preenchimento: `initialTitle`, `initialBody`, `initialAiContext`, `sourceLabel`
- `sourceLabel`: exibe banner "Preparando publicação a partir do vídeo '…'" no passo 1
- EC criado no passo 1 ao clicar "Próximo" (partial persistence intencional)
- Rollback: se CP falha → DELETE EC; se DELETE também falha → toast com link para EC workspace
- Abandonment (Opção A): fechar com EC criado → toast "Conteúdo editorial salvo" + link "Abrir"
- Guards de duplo clique: `isHandlingNextRef` e `isHandlingCreateRef` (useRef, síncronos)
- Reset completo ao reabrir: usa os `initial*` props como valores base

---

## Restrições absolutas (mantidas em P1–P6)

- ✅ Rota `POST /api/posts/generate-feed-text` **não foi alterada**
- ✅ Sem `service role` em nenhuma rota
- ✅ Sem conexão Postgres direta
- ✅ Supabase MCP usado apenas em modo read-only para validações
- ✅ Sem merge em `main`

---

## Estado atual dos branches

Todos os branches P1–P6 estão em `feat/publication-p*` (não mergeados em `main`).  
Branch P6 (`feat/publication-p6-post-video-flow`) é o HEAD mais recente e contém todas as correções acumuladas.

Commits relevantes do P6:
- `47625e4` — `feat: add post-video publication flow (P6)`
- `e63cceb` — `fix: harden publication quick flow lifecycle` (P5 audit fixes)
- `bc22918` — docs P5
- `4871ac9` — `feat: add production publication quick flow` (P5 feature)

---

## Pendências conhecidas

### Não implementado (fora de escopo P1–P6)

| Item | Prioridade sugerida | Notas |
|------|---------------------|-------|
| Migration `021_create_publication_entities.sql` aplicada no Supabase de produção | **Bloqueante** | A migration está no repo mas não foi aplicada via Supabase MCP; aguarda autorização explícita |
| `Distribution` (publicação real via API de canal) | Alta | Requer credenciais de API por canal (Instagram Graph, YouTube Data, etc.) |
| FK `source_video_draft_id` em `editorial_contents` | Baixa | Rastreabilidade causal explícita; atualmente implícita via `production_id` |
| `generate-body` whitelist de chaves desconhecidas | Muito baixa | Inconsistência de contrato detectada em P4; sem impacto funcional ou de segurança |
| `channel_piece.image_url` / `ChannelPieceAsset` | Média | Assets de mídia por peça (imagem de capa, thumbnail, etc.) |
| Pre-seleção `youtube/video_description` no Quick Flow de vídeo | Baixa | Agiliza fluxo de criação de descrição de vídeo no YouTube |
| `source_video_draft_id` opcional em `editorial_contents` | Baixa | Rastrear qual vídeo originou o EC |
| Teste cross-user (isolamento RLS com 2 contas) | Média | Validado em inspeção de código + tripla camada; não executado por ter apenas 1 conta disponível |

### Bug pré-existente (não relacionado a publicações)

- `app/(dashboard)/imagens/rascunhos/page.tsx:43` — TS7006: parâmetro `d` sem tipo implícito `any`. Presente desde antes de P1; fora de escopo.

---

## Como retomar o desenvolvimento

### Para fazer merge em main

1. Verificar se a migration 021 foi aplicada em produção (Supabase dashboard)
2. Fazer merge dos branches em ordem: P1 → P2 → P3 → P4 → P5 → P6 (ou squash do P6 que inclui tudo)
3. Rodar `pnpm build` final pós-merge
4. Testar smoke: `/publicacoes`, `/videos`, production detail

### Para continuar no P6 (melhoria incremental)

O branch `feat/publication-p6-post-video-flow` está limpo e buildando. Qualquer novo incremento deve criar um branch a partir dele.

### Para adicionar um canal novo

1. Atualizar `lib/publication-channels.ts`: adicionar ao `PUBLICATION_CHANNELS`, `PUBLICATION_FORMATS`, e `CHANNEL_FORMAT_MAP`
2. Atualizar `CHANNEL_FORMAT_CONTEXT` em `generate-body/route.ts` com instruções de contexto por formato
3. Atualizar labels em `CHANNEL_LABELS` e `FORMAT_LABELS` nos componentes de UI

---

## Arquivos centrais do domínio

| Arquivo | Propósito |
|---------|-----------|
| `lib/types.ts` | Tipos `EditorialContent`, `ChannelPiece`, `PublicationChannel`, `PublicationFormat`, etc. |
| `lib/publication-channels.ts` | Constantes de canais/formatos válidos e funções de validação |
| `scripts/021_create_publication_entities.sql` | Migration das tabelas |
| `components/publication/quick-flow-dialog.tsx` | Dialog de criação rápida EC→CP (entry point principal) |
| `app/(dashboard)/publicacoes/page.tsx` | Hub global |
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Workspace de detalhe |
| `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` | Aba Conteúdos da Production |
| `app/(dashboard)/videos/page.tsx` | Entry point de vídeo para publicação |

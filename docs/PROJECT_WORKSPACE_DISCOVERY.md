# PROJECT_WORKSPACE_DISCOVERY.md
**Discovery · Somente Leitura · 2026-06-24**  
**Atualizado pós-M10-A · 2026-06-25**

> Auditoria completa do estado atual da página do Projeto, dependências,
> fluxos paralelos, dados sem Production, e riscos de consolidação.
> Nenhuma implementação foi realizada neste documento.
>
> **M10-A executado em 2026-06-25:** Production "Arquivo — Alquimia Cibernética"
> criada e 6 drafts reais atribuídos. Os 3 registros de teste permanecem com
> `production_id = NULL`. Manifesto: `docs/migrations/project-archive-m10a.json`.
>
> **M10-B executado em 2026-06-25:** Abas Imagens e Vídeos removidas da página do Projeto.
> Productions é agora a única seção operacional. Estrutura de Tabs eliminada.
> Queries de `image_drafts`/`video_drafts` removidas da página.

---

## 1. Estado Atual da Página do Projeto

### 1.1 Estrutura de arquivos sob `/projetos/[id]/`

```
app/(dashboard)/projetos/[id]/
  page.tsx                                     ← Página principal do Projeto
  producoes/[productionId]/page.tsx            ← Detalhe da Production
  conteudos/[editorialContentId]/page.tsx      ← Detalhe do EditorialContent
```

### 1.2 Componente principal: `ProjectDetailPage`

**Arquivo:** `app/(dashboard)/projetos/[id]/page.tsx`

#### Cabeçalho e card de identidade

O card de identidade exibe todos os campos de contexto do projeto:

| Campo | UI | Ação disponível |
|-------|-----|----------------|
| `name` | Título principal | Editável via modal |
| `created_at` | Data de criação | Somente leitura |
| `status` | Badge (Ativo / Arquivado) | Editável via modal |
| `description` | Texto expansível | Copiável + Editável |
| `context` | Caixa "Contexto para IA" | Copiável + Editável |
| `style_profile` | Caixa "Perfil de Estilo" | Copiável + Editável |

#### Botões de ação no card

| Botão | Comportamento |
|-------|--------------|
| Editar | Abre `ProjectForm` modal |
| Excluir | Bloqueado se existem Productions; alerta de confirmação se vazio |

#### Abas (TabsList com 3 itens)

```
[Imagens (N)] [Vídeos (N)] [Produções (N)]
```

### 1.3 Aba Imagens

**Query:** `image_drafts.select('*').eq('project_id', projectId)` — direto no Supabase (client-side)

**Depende de:** `project_id` apenas. Não filtra por `production_id`.

**Estado vazio:** botão "Criar Imagem" → `/imagens?project=${projectId}` ⚠️ bypassa Production

**Estado com dados:** grade 3 colunas com cards:
- Thumbnail (se `image_url` presente)
- `user_input` (2 linhas)
- Badge com `image_status`

**Problema:** O botão "Criar Imagem" direciona para a page global de imagens com apenas o `project_id`, sem `production_id`. Qualquer ImageDraft criado por esse caminho nasce desvinculado de Production.

### 1.4 Aba Vídeos

**Query:** `video_drafts.select('*').eq('project_id', projectId)` — direto no Supabase (client-side)

**Depende de:** `project_id` apenas. Não filtra por `production_id`.

**Estado vazio:** botão "Criar Vídeo" → `/videos?project=${projectId}` ⚠️ bypassa Production

**Estado com dados:** grade 2 colunas com cards:
- `name` ou "Rascunho sem título"
- Badge com contagem de cenas
- Data de atualização

**Problema:** Mesmo problema da aba Imagens — o botão bypassa Production.

### 1.5 Aba Produções

**Query:** `GET /api/productions?projectId=${projectId}` (via fetch)

**Depende de:** `project_id` apenas.

**Estado vazio:** botão "Criar primeira Produção" → abre `ProductionForm` modal

**Estado com dados:** lista de cards com:
- Título, Badge de tipo (Editorial / Branding / Campanha)
- `intention` (2 linhas)
- Data de atualização
- Botões Editar / Excluir (inline)
- Card clicável → `/projetos/${projectId}/producoes/${prod.id}`

**Botão "Nova Produção":** sempre visível no topo da aba (independente do estado).

### 1.6 Modais e diálogos

| Dialog | Trigger | Comportamento |
|--------|---------|--------------|
| `ProjectForm` | Botão Editar | Edita campos do projeto |
| `ProductionForm` | Botão Nova Produção | Cria ou edita Production |
| `AlertDialog` — excluir projeto | Botão Excluir (sem productions) | Confirmação de exclusão |
| `Dialog` — bloqueio de exclusão | Botão Excluir (com productions) | Informa quantidade e redireciona para aba Produções |
| `AlertDialog` — excluir production | Ícone de lixo em cada Production | Confirmação de exclusão da Production |

---

## 2. APIs Consultadas

| Recurso | Método | Origem | Filtro |
|---------|--------|--------|--------|
| `projects` | SELECT * | Supabase client (direto) | `id = projectId` |
| `image_drafts` | SELECT * | Supabase client (direto) | `project_id = projectId` |
| `video_drafts` | SELECT * | Supabase client (direto) | `project_id = projectId` |
| Productions | GET | `/api/productions?projectId=` | `project_id` |
| Productions (create) | POST | `/api/productions` | — |
| Productions (edit) | PATCH | `/api/productions/[id]` | — |
| Productions (delete) | DELETE | `/api/productions/[id]` | — |

---

## 3. Página de Detalhe da Production (referência)

**Arquivo:** `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`

Exibe 4 abas: **Overview | Imagens | Vídeos | Conteúdos Editoriais**

| Aba | Dados | Criação via |
|-----|-------|------------|
| Overview | Contagens + quick actions | QuickFlowDialog |
| Imagens | `GET /api/image-drafts?productionId=` | `/imagens?project=P&production=X` ✅ |
| Vídeos | `GET /api/video-drafts?productionId=` | `/videos?project=P&production=X` ✅ |
| Conteúdos | `GET /api/editorial-contents?productionId=` | Modal inline ✅ |

A página da Production **já passa `production_id` em todas as criações** — o fluxo correto existe e está funcionando.

---

## 4. Dados sem Production — Auditoria do Banco

### 4.1 Contagens gerais

> **Estado pós-M10-A (2026-06-25):** M10-A atribuiu 4 ImageDrafts + 2 VideoDrafts à
> Production "Arquivo — Alquimia Cibernética". Os 3 testes permanecem sem production_id.

| Tabela | Total | com project_id | com production_id | sem production_id |
|--------|-------|---------------|------------------|------------------|
| `image_drafts` | 7 | 7 | 5 *(era 1)* | **2** *(eram 6)* |
| `video_drafts` | 4 | 4 | 3 *(era 1)* | **1** *(eram 3)* |
| `editorial_contents` | 7 | 7 | 5 | **2** |
| `channel_pieces` | 6 | n/a | n/a | n/a |
| `productions` | 2 | 2 | n/a | n/a |
| `images` (geradas) | 15 | 13 | **sem campo** | **sem campo** |
| `library_files` | 4 | 4 | **sem campo** | **sem campo** |
| `posts` (legado) | 4 | 3 | 4 | 0 |

> `images` e `library_files` não possuem coluna `production_id` — são sempre acessíveis apenas por `project_id`.

### 4.2 ImageDrafts sem Production — estado pós-M10-A

Todos pertencem ao Projeto **"Alquimia Cibernética"** (id: `0b04df8b`).

| id (prefixo) | user_input | image_status | tem image_url | production_id | M10-A |
|-------------|-----------|-------------|--------------|--------------|-------|
| `d52b83b6` | "uma montanha antiga" | draft | ❌ | NULL (teste) | preservado |
| `8c5bbdb7` | "consciência e tecnologia..." | draft | ❌ | NULL (teste) | preservado |
| `c44bf448` | "Um símbolo mágico" | draft | ✅ | Arquivo ✓ | atribuído |
| `97508404` | "Uma floresta vista do alto..." | draft | ✅ | Arquivo ✓ | atribuído |
| `e624d457` | "Criar um objeto mágico" | draft | ✅ | Arquivo ✓ | atribuído |
| `0eb2a983` | "Uma imagem sobre Alquimia Cibernética" | draft | ✅ | Arquivo ✓ | atribuído |

### 4.3 VideoDrafts sem Production — estado pós-M10-A

Todos pertencem ao Projeto **"Alquimia Cibernética"** (id: `0b04df8b`).

| id (prefixo) | name | num_scenes | production_id | M10-A |
|-------------|------|-----------|--------------|-------|
| `f1029001` | "aluimia01" | 2 | Arquivo ✓ | atribuído |
| `d46d2259` | "teste3" | 2 | Arquivo ✓ | atribuído |
| `0bc4324c` | "testevideo" | 1 | NULL (teste) | preservado |

### 4.4 EditorialContents sem Production (2 registros)

Ambos pertencem ao Projeto **"Content Agent"** (id: `d0d008c3`).

| id (prefixo) | title | status | channel_pieces | created_at |
|-------------|-------|--------|--------------|-----------|
| `6d7d1a9a` | "Post no Youtube" | draft | 0 | 2026-06-23 |
| `cb996953` | "Novo Conteúdo" | draft | 0 | 2026-06-23 |

### 4.5 Productions vazias

| id (prefixo) | title | project | image_drafts | video_drafts | editorial_contents |
|-------------|-------|---------|-------------|-------------|------------------|
| `c859d21f` | "teste" | Alquimia Cibernética | 0 | 0 | 0 |

### 4.6 Posts legados (migrados)

| id (prefixo) | project_id | production_id | channel | migrated_at |
|-------------|-----------|--------------|--------|------------|
| `d02a9507` | Content Agent | Teste publicação 01 | instagram_post | 2026-06-24 |
| `7eb9ccf4` | Content Agent | Teste publicação 01 | youtube_post | 2026-06-24 |
| `083a69d5` | **null** | Teste publicação 01 | instagram_story | 2026-06-24 |
| `7aa6b5a4` | Content Agent | Teste publicação 01 | youtube_video | 2026-06-24 |

> Post `083a69d5` (instagram_story) tem `project_id = null` — comportamento esperado,
> documentado na migration M9. O dado foi migrado com production_id correto.

### 4.7 Images geradas (sem campo production_id)

| status | total | com storage_path |
|--------|-------|-----------------|
| approved | 3 | 1 |
| draft | 11 | 6 |
| generating | 1 | 0 |

Todas as 15 images geradas são acessíveis apenas por `project_id`. Não existe caminho para acessá-las por `production_id` sem passar pelo `image_drafts` → `current_image_id`.

### 4.8 LibraryFiles

| id (prefixo) | project | name | kind | deleted_at |
|-------------|---------|------|------|-----------|
| `84d83a03` | Alquimia Cibernética | slide01.png | image | null |
| `48a854b3` | Alquimia Cibernética | slide01_01.png | image | null |
| `47d2a2b9` | Alquimia Cibernética | ReportOptimizer-197876869...xml | document | null |
| `f190c6ad` | Content Agent | Content-Agent-Studio-Future-Vision-Concept.png | image | null |

Nenhum LibraryFile tem `production_id` — a tabela não possui esse campo.

---

## 5. Projetos Ativos

| id (prefixo) | name | Productions | ImageDrafts | VideoDrafts | ECs | created_at |
|-------------|------|------------|------------|------------|-----|-----------|
| `0b04df8b` | Alquimia Cibernética | 2 (1 Arquivo ✓) | 7 (2 testes sem prod) | 4 (1 teste sem prod) | 0 | 2026-04-24 |
| `d0d008c3` | Content Agent | 1 (ativa) | 1 (1 com prod) | 1 (1 com prod) | 7 (5 com prod) | 2026-06-23 |

---

## 6. Fluxos Paralelos que Bypassam Production

### Fluxo 1 — Project page → Criar Imagem

```
/projetos/[id]
  → aba Imagens
    → botão "Criar Imagem"
      → /imagens?project=${projectId}
        → cria ImageDraft com project_id, production_id = NULL
```

**Risco:** `production_id` nasce nulo. O draft fica visível na aba Imagens do Projeto
mas nunca aparece na aba Imagens de nenhuma Production.

### Fluxo 2 — Project page → Criar Vídeo

```
/projetos/[id]
  → aba Vídeos
    → botão "Criar Vídeo"
      → /videos?project=${projectId}
        → cria VideoDraft com project_id, production_id = NULL
```

**Risco:** mesmo do Fluxo 1.

### Fluxo 3 — /imagens global (sem project nem production)

```
/imagens
  → sem project selecionado
    → cria ImageDraft com project_id = NULL, production_id = NULL
```

**Risco:** draft completamente órfão — não aparece no Projeto nem na Production.

### Fluxo 4 — /videos global

Idem ao Fluxo 3, para video_drafts.

### Fluxo 5 — Novo EditorialContent sem production

```
/projetos/[id]/producoes/[productionId]
  → aba Conteúdos
    → modal de criação
      → campo production é pré-selecionado MAS o usuário pode limpar
```

O modal de criação do EC pré-seleciona a Production da URL, mas o campo é editável — o usuário pode criar um EC com `production_id = null` manualmente.

---

## 7. Riscos de Consolidação

| Risco | Severidade | Afeta |
|-------|-----------|-------|
| Remover aba Imagens do Projeto: 6 image_drafts ficam inacessíveis pela UI | **ALTO** | Alquimia Cibernética |
| Remover aba Vídeos do Projeto: 3 video_drafts ficam inacessíveis pela UI | **ALTO** | Alquimia Cibernética |
| images geradas não têm production_id: perda de acesso se filtro mudar | **MÉDIO** | Todos os projetos |
| library_files sem production_id: não participam do fluxo editorial | **BAIXO** | Todos os projetos |
| EC `6d7d1a9a` e `cb996953` sem production: órfãos de teste | **BAIXO** | Content Agent |
| Post `083a69d5` sem project_id: não aparece em filtros por projeto | **BAIXO** | Comportamento esperado pós-M9 |

---

## 8. Resumo Diagnóstico — estado pós-M10-B (2026-06-25)

| Dimensão | Status |
|----------|--------|
| Fluxo Production (novo) | ✅ Funcionando corretamente |
| Seção Produções na página do Projeto | ✅ Única seção operacional — M10-B |
| Fluxo Imagens/Vídeos via Production | ✅ Funcionando |
| Aba Imagens na página do Projeto | ✅ Removida — M10-B |
| Aba Vídeos na página do Projeto | ✅ Removida — M10-B |
| Botões Criar Imagem / Criar Vídeo na página do Projeto | ✅ Removidos — M10-B |
| Queries image_drafts / video_drafts na página do Projeto | ✅ Removidas — M10-B |
| ImageDrafts sem Production (reais) | ✅ 0 — M10-A atribuiu todos os 4 |
| ImageDrafts sem Production (testes) | ℹ️ 2 registros preservados, não exibidos |
| VideoDrafts sem Production (reais) | ✅ 0 — M10-A atribuiu todos os 2 |
| VideoDrafts sem Production (testes) | ℹ️ 1 registro preservado, não exibido |
| images geradas sem production_id | ℹ️ Schema não possui esse campo |
| library_files sem production_id | ℹ️ Schema não possui esse campo |
| EditorialContents sem Production | ℹ️ 2 registros de teste |
| Posts migrados | ✅ Todos com production_id |

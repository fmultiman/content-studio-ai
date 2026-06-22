# Content Agent Studio — Plano de Implementação: Production
**Fase 2 · Incremento B · Junho 2026**

> Este documento transforma as decisões arquiteturais de `PRODUCTION_DECISIONS.md`
> em um plano de implementação incremental, pequeno e reversível.
>
> Cada afirmação sobre o estado atual do código é rastreável a um arquivo específico.
> As hipóteses ainda não validadas no código estão explicitamente marcadas.
>
> Não há código, migration ou componente neste documento — apenas o plano.

---

## 1. Estado Confirmado do Código Relevante

### 1.1 Schema atual — fatos confirmados pelos scripts SQL

**Tabela `projects`** (`scripts/001_create_tables.sql` + `scripts/017–019`)
```
id UUID PK
user_id UUID NOT NULL → auth.users CASCADE DELETE
name TEXT NOT NULL
description TEXT
context TEXT
status TEXT DEFAULT 'active' CHECK ('active','archived')
style_profile TEXT            (adicionado depois de 001)
evaluation_mode TEXT DEFAULT 'default'  (script 019)
created_at, updated_at TIMESTAMPTZ
```

**Tabela `image_drafts`** (`scripts/002` + `scripts/006b,008,009,010,011`)
```
id UUID PK
user_id UUID NOT NULL → auth.users CASCADE DELETE
project_id UUID → projects ON DELETE SET NULL   ← NULLABLE
name TEXT
user_input TEXT NOT NULL
generated_prompt TEXT
generated_prompt_pt TEXT      (script 006b)
prompt_details JSONB          (deduzido do código)
current_evaluation JSONB      (deduzido do código)
generation_attempts JSONB     (deduzido do código)
current_attempt INTEGER
image_status TEXT
auto_mode BOOLEAN DEFAULT false
image_url TEXT
current_image_id UUID → images  (script 011)
selected_model TEXT           (script 008)
workspace_state JSONB         (script 010)
created_at, updated_at TIMESTAMPTZ
```

**Tabela `video_drafts`** (`scripts/002`)
```
id UUID PK
user_id UUID NOT NULL → auth.users CASCADE DELETE
project_id UUID → projects ON DELETE SET NULL   ← NULLABLE
name TEXT NOT NULL
scenes JSONB DEFAULT '[]'
created_at, updated_at TIMESTAMPTZ
```

**Tabela `posts`** (`scripts/012,014`)
```
id UUID PK
user_id UUID NOT NULL → auth.users CASCADE DELETE
project_id UUID → projects ON DELETE SET NULL   ← NULLABLE
name TEXT NOT NULL
channel TEXT NOT NULL DEFAULT 'instagram_post'
description TEXT
ai_context TEXT
feed_text TEXT
image_url TEXT
status TEXT DEFAULT 'draft' CHECK ('draft','saved')
created_at, updated_at TIMESTAMPTZ
```
Nota: `post_images` (script 014) é uma estrutura JSON por post, não uma tabela separada em FK.

**Tabela `images`** (`scripts/001,013`)
```
id UUID PK
user_id UUID NOT NULL → auth.users CASCADE DELETE
project_id UUID → projects ON DELETE SET NULL   ← NULLABLE
user_input TEXT NOT NULL
generated_prompt TEXT
image_url TEXT
status TEXT CHECK ('draft','generating','approved','rejected')
model, aspect_ratio, style TEXT
metadata JSONB
storage_path, thumbnail_url, thumbnail_path, storage_provider TEXT  (script 013)
file_size INTEGER, mime_type TEXT
created_at, updated_at TIMESTAMPTZ
```

### 1.2 Padrões estruturais confirmados

**FK para `project_id`:** TODAS as entidades de trabalho usam
`project_id UUID REFERENCES projects(id) ON DELETE SET NULL` — nullable, sem cascade delete.
Isso significa que deletar um Projeto não deleta imagens/drafts/posts — apenas desvincula.

**RLS:** Padrão idêntico em todas as tabelas:
```sql
CREATE POLICY "select_own" ON tabela FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON tabela FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON tabela FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "delete_own" ON tabela FOR DELETE USING (auth.uid() = user_id);
```

**Trigger `updated_at`:** A função `update_updated_at_column()` existe e é aplicada
em todas as tabelas via trigger `BEFORE UPDATE`.

**Índices:** Padrão `idx_{tabela}_user_id` e `idx_{tabela}_project_id` em todas.

### 1.3 Padrão de API routes confirmado

`/api/image-drafts` (GET/POST/PATCH/DELETE) — arquivo `app/api/image-drafts/route.ts`
- GET com `?id=` para draft específico ou lista `?limit=5`
- POST/PATCH aceitam `projectId` e persistem como `project_id`
- PATCH identifica o draft pelo campo `id` no body
- DELETE via `?id=` na query string
- Autenticação: `createClient()` server + `getUser()` a cada request

`/api/video-drafts`, `/api/posts` — mesmo padrão estrutural.

### 1.4 Como o projeto é mantido na UI — confirmado

**Sidebar** (`components/layout/sidebar.tsx`): Flat, 8 links fixos. Sem conceito de
"projeto atual" globalmente — nenhum estado de projeto é compartilhado entre páginas.

**Página `/imagens`** (`app/(dashboard)/imagens/page.tsx`):
- Recebe `?project=<id>` via `useSearchParams()`
- Na linha ~352: `const projectId = searchParams.get('project'); if (projectId) setSelectedProject(projectId)`
- O `selectedProject` é incluído no auto-save do draft (campo `project_id`)
- O draft restaura o `selectedProject` quando carregado (linha ~234: `setSelectedProject(draft.project_id)`)

**Página `/projetos/[id]`** (`app/(dashboard)/projetos/[id]/page.tsx`):
- Botão "Criar Imagem" → `router.push('/imagens?project=${projectId}')`
- Botão "Criar Vídeo" → `router.push('/videos?project=${projectId}')`
- Tabs atuais: "Imagens" e "Vídeos" apenas. Sem Posts, sem Arquivos.
- NÃO busca image_drafts nem video_drafts — apenas `images` e `videos` finalizados.

### 1.5 Fatos sobre geração atual

- `image_drafts.project_id` é NULLABLE — drafts sem projeto já existem e funcionam
- O Image Evaluator recebe `evaluation_mode` via body do request, não do banco diretamente
- O Gerador de Prompt recebe `project.context`, `project.style_profile` e `evaluation_mode`
  todos buscados manualmente pela página de imagens (não pelo draft)
- Não existe coluna `production_id` em nenhuma tabela hoje
- Não existe tabela `productions`

---

## 2. Escopo do MVP

### O que o MVP de Production deve fazer

O MVP satisfaz **uma única necessidade**: permitir que o usuário agrupe seu trabalho
dentro de um Projeto sob uma intenção nomeada, e veja os artefatos (imagens, rascunhos,
posts) organizados dentro dessa unidade.

MVP em uma frase: **"Criar uma Produção em um Projeto, abrir o workspace de imagens
já vinculado a ela, e ver o rascunho aparecer na Produção ao voltar."**

### O que o MVP NÃO precisa fazer

- Calcular status da Produção (Aberta, Em Produção, etc.) — visível na v2
- Sugerir pipeline ou agentes — requer o Planejador (Fase C)
- Expor os timestamps de milestone — visível na v2
- Suportar Produções derivadas — Fase D
- Criar Workspace Pessoal automaticamente — v2 do MVP
- Mostrar capabilities por tipo — visível quando houver mais de um pipeline implementado
- Mudar a navegação global (sidebar) — conservador por padrão

### Critério de MVP bem-sucedido

Um usuário consegue, **sem erros e sem ajuda**:
1. Entrar em um Projeto existente
2. Criar uma Produção com título, intenção e tipo
3. Entrar na Produção
4. Abrir o workspace de imagens a partir da Produção
5. Gerar uma imagem normalmente (sem mudança no comportamento)
6. Voltar à Produção e ver o rascunho de imagem listado lá

**Tudo o que já existia antes continua funcionando exatamente igual.**

---

## 3. Campos da Primeira Versão

### Tabela `productions` — schema mínimo

| Campo | Tipo | Constraint | Justificativa |
|-------|------|-----------|---------------|
| `id` | UUID | PK, gen_random_uuid() | Padrão do sistema |
| `user_id` | UUID | NOT NULL → auth.users CASCADE | RLS e ownership |
| `project_id` | UUID | NOT NULL → projects CASCADE | D4: sem produção sem projeto |
| `title` | TEXT | NOT NULL | Identificação humana na lista |
| `intention` | TEXT | NOT NULL | Campo de nascimento (D1, LIFECYCLE) |
| `type` | TEXT | NOT NULL DEFAULT 'editorial' | D5: routing por tipo |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Padrão |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Trigger automático |

**Constraint de tipo no schema:**
```sql
CHECK (type IN (
  'editorial', 'branding', 'campaign',
  'research', 'documentation', 'digital_product', 'automation'
))
```
7 valores no banco, 3 visíveis na UI do MVP. Os outros 4 existem para não exigir
migration futura, mas não aparecem no formulário de criação da primeira versão.

### Por que NOT NULL em `project_id` agora

O Workspace Pessoal (D4) é uma melhoria de UX da v2 do MVP — requer lógica de
auto-criação de projeto. Na primeira versão, o formulário de criação de Produção
exige seleção de Projeto explícita. É um passo a mais, mas garante a invariante I1.

### Por que `title` é separado de `intention`

`intention` pode ser uma frase longa e natural: "Criar um post para divulgar o
lançamento do produto X para o público feminino 25-40 anos que usa Instagram".
Usar a intenção como título forçaria truncamento artificial. `title` é o nome
curto que aparece na lista; `intention` é o campo semântico que vai para os agentes.
O formulário pode sugerir automaticamente um título baseado na intenção (truncado),
que o usuário confirma ou edita.

### Campos explicitamente adiados para v2

| Campo | Razão do adiamento |
|-------|-------------------|
| `evaluation_mode` | Herda do Projeto (D2); override na Produção é feature de v2 |
| `channel` | Emerge do trabalho; não é necessário na criação |
| `audience` | Produzido pelo Planejador (Fase C) |
| `editorial_angle` | Produzido pelo Planejador (Fase C) |
| `production_brief` | Produzido pelo Planejador (Fase C) |
| `review_started_at` | Status avançado da v2 |
| `completed_at` | Status avançado da v2 |
| `published_at` | Status avançado da v2 |
| `cancelled_at` | Status avançado da v2 |
| `paused_at` | Status avançado da v2 |
| `archived_at` | Status avançado da v2 |
| `source_production_id` | Produções derivadas (Fase D) |

---

## 4. Relações da Primeira Versão

### Relações da tabela `productions`

```
productions.project_id  → projects.id  ON DELETE CASCADE
productions.user_id     → auth.users.id ON DELETE CASCADE
```

`ON DELETE CASCADE` em `project_id` (diferente do padrão `SET NULL` das outras tabelas):
uma Produção só faz sentido dentro de um Projeto — se o Projeto for deletado,
suas Produções devem ser deletadas também.

**Atenção:** Isso tem implicação na UI atual. O botão "Excluir Projeto" na página
`/projetos/[id]/page.tsx` executa um `DELETE` direto sem warning sobre Produções.
O AlertDialog existente diz "Todas as imagens e vídeos associados perderão a
referência" — esse texto precisará ser atualizado para incluir Produções. Isso é
um critério de aceite do Incremento 3 (UI).

### Relações com entidades existentes

| Tabela | Nova coluna | Tipo | Constraint | Comportamento |
|--------|------------|------|-----------|--------------|
| `image_drafts` | `production_id` | UUID | NULL → productions ON DELETE SET NULL | Nullable: drafts antigos continuam sem produção |
| `video_drafts` | `production_id` | UUID | NULL → productions ON DELETE SET NULL | Nullable: idem |
| `posts` | `production_id` | UUID | NULL → productions ON DELETE SET NULL | Nullable: idem |
| `images` | `production_id` | UUID | NULL → productions ON DELETE SET NULL | Opcional: adicionar na v2 |

**Por que `image_drafts.production_id` mas não `images.production_id` no MVP:**
O fluxo do MVP vincula a Produção ao **draft** (workspace de trabalho). As imagens
geradas são vinculadas ao draft via `images.project_id` e via o contexto do draft.
Para o MVP, mostrar os `image_drafts` de uma Produção é suficiente. Vincular `images`
individualmente é uma refinamento de v2 (quando a UI de aprovação dentro da Produção
for construída).

### Backfill de dados existentes

**Não há backfill.** Todos os `image_drafts`, `video_drafts` e `posts` existentes
continuam com `production_id = NULL`. Isso é correto e intencional:
- Eles pertencem a Projetos (via `project_id` existente)
- Não pertencem a nenhuma Produção específica
- Continuam aparecendo nas páginas globais (`/imagens`, `/videos`, `/posts`) normalmente
- Podem ser vinculados a uma Produção futura se o usuário decidir organizar retroativamente
  (feature de v2 — associar draft existente a uma Produção)

---

## 5. Vertical Slice Recomendado

### O slice

```
1. Usuário abre /projetos/<id>
2. Vê tab nova: "Produções (0)"
3. Clica "Nova Produção"
4. Modal: campos Título (sugerido, editável), Intenção (obrigatória), Tipo (3 opções)
5. Submete → Production criada no banco → modal fecha → lista atualiza "Produções (1)"
6. Clica no card da Produção → abre /projetos/<projectId>/producoes/<productionId>
                              (ou /producoes/<productionId> — ver D.H.1 abaixo)
7. Página de detalhe: título, intenção, tipo, data, 3 seções vazias (Imagens, Vídeos, Posts)
8. Clica "Criar Imagem" → vai para /imagens?project=<projectId>&production=<productionId>
9. Workspace de imagens abre normalmente com o Projeto pré-selecionado
10. Usuário gera imagem normalmente (comportamento idêntico ao atual)
11. Draft é salvo com production_id populado
12. Usuário clica "Voltar à Produção" (ou usa o browser back)
13. Detalhe da Produção mostra o card do draft na seção "Imagens"
```

### Por que este slice e não outro menor

**Não há slice menor que seja utilizável.** Um slice sem a vinculação (passo 11)
cria uma Produção sem artefatos — o usuário não veria nenhum benefício sobre
simplesmente trabalhar em `/imagens?project=X`. O valor da Production é exatamente
o agrupamento de artefatos: sem isso, ela é apenas um label extra.

**Por que não fazer uma parte apenas (schema + API) primeiro:**
O plano incremental abaixo separa exatamente em passos independentes — mas CADA
PASSO deve poder ser avaliado por um usuário real. Schema sem UI não é testável
por um usuário. O slice completo é o produto mínimo testável, mas a implementação
acontece em incrementos.

### O que o slice NÃO inclui (para não ser maior que o necessário)

- Status calculado da Produção na lista (mostrar apenas "Em andamento" estático no MVP)
- Edição ou exclusão de Produção (v2 do MVP)
- Vinculação de drafts existentes à Produção (v2 do MVP)
- Badge com contagem de artefatos atualizada em tempo real (v2 do MVP)
- Busca ou filtro de Produções (desnecessário com < 10 produções)

---

## 6. Sequência de Incrementos

### Incremento 1 — Schema da entidade Production

**Objetivo:** Criar a tabela `productions` e adicionar `production_id` nas tabelas existentes,
sem nenhuma mudança de comportamento visível ao usuário.

**Arquivos a criar:**
- `scripts/020_create_productions.sql`

**Conteúdo do script:**
```sql
-- Tabela productions
CREATE TABLE IF NOT EXISTS productions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  intention TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'editorial'
    CHECK (type IN ('editorial','branding','campaign','research',
                    'documentation','digital_product','automation')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE productions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "productions_select_own" ON productions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "productions_insert_own" ON productions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "productions_update_own" ON productions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "productions_delete_own" ON productions
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER productions_updated_at
  BEFORE UPDATE ON productions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_productions_user_id ON productions(user_id);
CREATE INDEX idx_productions_project_id ON productions(project_id);

-- Vincular production_id nas tabelas existentes
ALTER TABLE image_drafts
  ADD COLUMN IF NOT EXISTS production_id UUID
  REFERENCES productions(id) ON DELETE SET NULL;

ALTER TABLE video_drafts
  ADD COLUMN IF NOT EXISTS production_id UUID
  REFERENCES productions(id) ON DELETE SET NULL;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS production_id UUID
  REFERENCES productions(id) ON DELETE SET NULL;

CREATE INDEX idx_image_drafts_production_id ON image_drafts(production_id);
CREATE INDEX idx_video_drafts_production_id ON video_drafts(production_id);
CREATE INDEX idx_posts_production_id ON posts(production_id);
```

**Alterações de tipos (`lib/types.ts`):**
```typescript
// Adicionar tipo Production
export type ProductionType =
  | 'editorial' | 'branding' | 'campaign'
  | 'research' | 'documentation' | 'digital_product' | 'automation'

export interface Production {
  id: string
  user_id: string
  project_id: string
  title: string
  intention: string
  type: ProductionType
  created_at: string
  updated_at: string
}

// Atualizar ImageDraft, VideoDraft, Post para incluir o campo opcional:
// production_id: string | null
```

**Alterações de UI:** Nenhuma.

**Critérios de aceite:**
- Migration aplica sem erro em banco limpo e em banco com dados existentes
- `production_id` em `image_drafts`, `video_drafts`, `posts` é NULL em todos os registros existentes
- A aplicação continua funcionando exatamente igual (nenhum comportamento mudou)
- RLS impede que um usuário acesse produções de outro

**Riscos:**
- Nenhum — colunas nullable não quebram código existente
- Migration é 100% reversível: `DROP TABLE productions; ALTER TABLE image_drafts DROP COLUMN production_id;` etc.

**Rollback:**
```sql
ALTER TABLE image_drafts DROP COLUMN IF EXISTS production_id;
ALTER TABLE video_drafts DROP COLUMN IF EXISTS production_id;
ALTER TABLE posts DROP COLUMN IF EXISTS production_id;
DROP TABLE IF EXISTS productions;
```

---

### Incremento 2 — API routes de Productions

**Objetivo:** Criar as rotas `/api/productions` suficientes para listar, criar e
buscar Produções. Testável via browser devtools antes de qualquer UI.

**Arquivos a criar:**
- `app/api/productions/route.ts` — GET (lista por projeto) + POST (criar)
- `app/api/productions/[id]/route.ts` — GET (detalhe) + PATCH (atualizar) + DELETE

**GET `/api/productions?projectId=<id>`**
Retorna lista de produções do projeto, ordenada por `updated_at DESC`.
Valida que o projeto pertence ao usuário autenticado.

**POST `/api/productions`**
Body: `{ projectId, title, intention, type }`
Valida: `projectId` existe e pertence ao usuário; `title` e `intention` não vazios;
`type` é um valor válido. Cria e retorna a Production.

**GET `/api/productions/<id>`**
Retorna a Production com `user_id` validado via RLS.

**PATCH `/api/productions/<id>`**
Body: `{ title?, intention?, type? }` — atualiza campos enviados.
Não expõe `project_id` como editável (produção não muda de projeto).

**DELETE `/api/productions/<id>`**
Soft-delete pode ser considerado mas não é necessário no MVP.
Hard delete com RLS é suficiente.

**O que NÃO entra nessas rotas:**
- Listagem de artefatos vinculados — vem de outras rotas existentes
- Cálculo de status — v2
- Lógica de Workspace Pessoal — v2

**Critérios de aceite:**
- POST cria Production e retorna o objeto criado com `id`
- GET lista retorna apenas produções do projeto do usuário autenticado
- GET detalhe retorna 404 para Production de outro usuário
- DELETE remove sem afetar `image_drafts`, `video_drafts`, `posts` (apenas desvincula via `SET NULL`)
- Sem modificações nas rotas existentes

**Rollback:** Deletar os dois arquivos de rota. Nenhuma mudança no banco.

---

### Incremento 3 — UI de lista e criação (dentro do Projeto)

**Objetivo:** Adicionar a tab "Produções" à página `/projetos/[id]` e o modal de criação.

**Arquivos a modificar:**
- `app/(dashboard)/projetos/[id]/page.tsx`

**Mudanças na página do Projeto:**
1. Adicionar tab "Produções" ao `<Tabs>` existente (atual: 2 tabs — Imagens, Vídeos)
2. Buscar `productions` via `/api/productions?projectId=<id>` no `useEffect` existente
3. Renderizar lista de cards de Production (título, tipo, intenção truncada, data)
4. Botão "Nova Produção" que abre modal
5. Modal com 3 campos: Título, Intenção, Tipo (select com 3 opções)
6. Ao criar: chama POST, fecha modal, atualiza a lista
7. Atualizar o texto do AlertDialog de delete do projeto para mencionar Produções

**Novos arquivos a criar:**
- `components/productions/production-form.tsx` — modal de criação (reutilizável)
- `components/productions/production-card.tsx` — card na lista (opcional, pode ser inline)

**O que NÃO entra neste incremento:**
- Navegação para o detalhe da Production (os cards não são clicáveis ainda)
- Edição ou exclusão de Production
- Badge de contagem de artefatos (card mostra apenas título e tipo)

**Critérios de aceite:**
- Tab "Produções" aparece na página do Projeto
- Modal abre com os 3 campos corretos
- Validação no frontend: título e intenção obrigatórios
- Após criar, a lista atualiza sem reload da página
- Dados de imagens e vídeos existentes não são afetados

**Riscos:**
- A página `/projetos/[id]` já tem `useEffect` com múltiplas queries — adicionar
  mais uma query pode aumentar o tempo de carregamento se feito sem cuidado.
  Mitigação: buscar Productions em paralelo com as outras queries.

**Rollback:** Remover a tab "Produções" e os novos componentes. Sem mudança no banco.

---

### Incremento 4 — Página de detalhe da Production

**Objetivo:** Criar a rota de detalhe de uma Production e a navegação até ela.

**Arquivos a criar:**

**Decisão de roteamento** (ver D.H.1 em seção 11):
Rota recomendada: `/projetos/[id]/producoes/[productionId]`

- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`

**O que a página mostra:**
- Header: título da Production + breadcrumb "Projeto > Produção"
- Card de info: intenção, tipo, data de criação
- Botão "Editar" (opcional no MVP — pode ser v2)
- Seção "Imagens" — lista `image_drafts` com `production_id = this.id`
  (via query ao Supabase client-side ou nova rota de API)
- Seção "Vídeos" — lista `video_drafts` com `production_id = this.id`
- Seção "Publicações" — lista `posts` com `production_id = this.id`
- Todas as 3 seções inicialmente vazias com estado empty
- Botão "Criar Imagem" em cada seção (as de Vídeos e Posts ficam desabilitadas
  ou com CTA para vir nos próximos incrementos)

**Mudanças na lista do Incremento 3:**
- Cards de Production tornam-se clicáveis → navegam para a página de detalhe

**Critérios de aceite:**
- Acessar uma Production de outro usuário retorna 404 ou redirect
- Breadcrumb mostra o caminho correto
- Seções exibem estado vazio corretamente
- Botão "Criar Imagem" existe e está habilitado
- Botão "Criar Vídeo" pode existir mas vinculação vem no Incremento 5

**Rollback:** Remover o arquivo de rota. Cards na lista param de ser clicáveis.

---

### Incremento 5 — Vinculação de workspaces à Production

**Objetivo:** Quando o usuário chega em `/imagens?production=<id>`, o draft é salvo
com `production_id`, e a Production mostra o draft na seção "Imagens" ao retornar.

**Arquivos a modificar:**

**`app/(dashboard)/imagens/page.tsx`:**
- Ler `searchParams.get('production')` (junto com o `project` já existente)
- Incluir `productionId` no state
- Passar `productionId` no payload do auto-save (já vai para `saveImageDraft`)
- Exibir breadcrumb "Produção > Workspace de Imagens" quando `productionId` presente
- Botão "Voltar à Produção" quando `productionId` presente

**`app/api/image-drafts/route.ts`:**
- Aceitar `productionId` no body do POST/PATCH
- Persistir como `production_id` no banco
- Retornar `production_id` no GET

**`lib/types.ts`:**
- `ImageDraft.production_id: string | null` já adicionado no Incremento 1

**Página de detalhe da Production (Incremento 4):**
- A query de `image_drafts` com `production_id = <id>` já funciona após schema do Incremento 1
- Exibir nome, `user_input` truncado e data do draft no card da seção "Imagens"
- Link no card do draft → `/imagens?draft=<id>&production=<productionId>&project=<projectId>`

**Critérios de aceite:**
- Navegar de Production → "Criar Imagem" abre `/imagens?project=X&production=Y`
- Draft gerado nessa sessão tem `production_id` populado no banco
- Ao retornar à Production, o draft aparece na seção "Imagens"
- Abrir `/imagens` diretamente (sem `?production`) continua funcionando igual
- Drafts existentes sem `production_id` continuam aparecendo em `/imagens/rascunhos` normalmente
- Comportamento de geração de imagem não mudou em nada

**Rollback:**
- `app/(dashboard)/imagens/page.tsx`: remover leitura de `?production` e o field no save
- `app/api/image-drafts/route.ts`: ignorar `productionId` no body (ou deixar — sem efeito)
- Dados no banco com `production_id` populado permanecem mas não afetam nada

---

## 7. Critérios de Aceite Globais

Ao final dos 5 incrementos, o sistema deve satisfazer:

**Funcionais:**
- [ ] Usuário pode criar uma Production em um Projeto existente
- [ ] Production aparece listada na tab "Produções" do Projeto
- [ ] Usuário pode navegar para o detalhe da Production
- [ ] Usuário pode abrir o workspace de imagens a partir da Production
- [ ] Draft gerado no workspace fica visível na Production
- [ ] Production pode ser deletada sem afetar imagens/drafts existentes do Projeto

**Compatibilidade:**
- [ ] Todos os fluxos existentes funcionam identicamente (sem regressão)
- [ ] `image_drafts` sem `production_id` continuam funcionando
- [ ] Páginas globais `/imagens`, `/videos`, `/posts` não mudaram de comportamento
- [ ] Deletar um Projeto com Produções é bloqueado pelo banco; UI orienta o usuário a remover as Produções primeiro

**Qualidade:**
- [ ] Nenhuma Production é acessível por outro usuário (RLS verificada)
- [ ] Formulário de criação valida campos obrigatórios no frontend
- [ ] API valida campos obrigatórios no backend (sem depender do frontend)
- [ ] Erros de API são exibidos ao usuário (não apenas logados no console)

---

## 8. Compatibilidade com Dados Existentes

### Regra geral: aditividade

Todas as mudanças são aditivas — nenhuma coluna existente é removida ou renomeada.
Nenhum dado existente é modificado. Nenhum comportamento existente é alterado.

### Análise por entidade

**`image_drafts` existentes:** `production_id = NULL`. Continuam funcionando em
`/imagens`, `/imagens/rascunhos`. Não aparecem em nenhuma Production. Correto.

**`video_drafts` existentes:** Idem. `production_id = NULL`. Página `/videos` inalterada.

**`posts` existentes:** Idem. `production_id = NULL`. Página `/posts` inalterada.

**`images` existentes:** Sem mudança — `production_id` NÃO é adicionado a `images`
no MVP. A tabela `images` fica como está.

**`projects` existentes:** Sem mudança. Apenas recebem uma nova tab na página de
detalhe. O comportamento do Projeto não muda.

### O que acontece quando o usuário tenta deletar um Projeto com Produções

A FK `productions.project_id → projects ON DELETE RESTRICT` significa que o banco
**bloqueia** o DELETE se existirem Produções vinculadas. O `supabase.from('projects').delete()`
retorna erro `23503 foreign_key_violation` e o Projeto não é deletado.

**Fluxo com RESTRICT:**
```
DELETE projects WHERE id = X
  → banco verifica: EXISTS (SELECT 1 FROM productions WHERE project_id = X)
  → se sim → erro 23503, operação abortada, nada é alterado
  → se não → delete prossegue normalmente
              → SET images.project_id = NULL (SET NULL — já existente)
              → SET image_drafts.project_id = NULL (SET NULL — já existente)
              → SET video_drafts.project_id = NULL (SET NULL — já existente)
              → SET posts.project_id = NULL (SET NULL — já existente)
```

O Incremento 3 deve atualizar o fluxo de delete do Projeto para:
1. Ao clicar "Excluir Projeto": buscar `COUNT(*) FROM productions WHERE project_id = X`
2. Se `count > 0`: exibir dialog diferente — "Este projeto tem N Produções. Exclua
   ou mova as Produções antes de continuar." Com link direto para a tab de Produções.
3. Se `count = 0`: exibir o AlertDialog existente com texto atualizado.

---

## 9. Riscos e Rollback

### Risco 1: `ON DELETE RESTRICT` e o código de delete de Projeto existente

**Risco:** O código atual em `projetos/[id]/page.tsx` executa
`supabase.from('projects').delete().eq('id', project.id)` direto.
Com RESTRICT, se houver Produções, esse DELETE retorna erro `23503`.
O código atual captura o erro com `catch (error)` mas exibe apenas um toast
genérico — o usuário não saberá que a causa foi Produções existentes.

**Mitigação:** Isso é resolvido no Incremento 3:
- Antes de exibir o AlertDialog, buscar `COUNT(*) FROM productions WHERE project_id = X`
- Se `count > 0`: substituir o AlertDialog por mensagem orientativa com link para Produções
- Se `count = 0`: fluxo normal (o RESTRICT nunca dispara)
- O RESTRICT no banco é uma rede de segurança; a UI deve evitar que o erro chegue ao banco

**Rollback isolado (se necessário mudar a política):**
```sql
ALTER TABLE productions DROP CONSTRAINT productions_project_id_fkey;
ALTER TABLE productions
  ADD CONSTRAINT productions_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
```
Não afeta schema de outras tabelas. Pode ser feito a qualquer momento.

### Risco 2: `project_id NOT NULL` no formulário de criação

**Risco:** Usuário sem Projetos não consegue criar uma Production. O MVP não
implementa o Workspace Pessoal.

**Mitigação:** A UI deve detectar se o usuário tem projetos e exibir um CTA para
criar um projeto primeiro, antes de criar uma Production.

**Rollback:** N/A — é um fluxo de UX, não um risco técnico.

### Risco 3: A página `/imagens` é um "Deus Componente" de 1275 linhas

**Risco:** Adicionar `production_id` ao auto-save do `image_drafts/page.tsx`
pode introduzir bugs em um componente altamente stateful e já complexo.

**Mitigação:** O Incremento 5 faz a menor mudança possível no componente:
- Leitura de `searchParams.get('production')` (1 linha adicional)
- Passagem de `productionId` no body do save (1 field adicional)
- Exibição de breadcrumb/botão "voltar" quando presente (UI condicional simples)

Não tocar em nenhuma lógica de geração, avaliação ou auto-save existente.

**Rollback do Incremento 5:** Remover as 3 adições acima. O componente volta ao estado anterior.

### Risco 4: Performance da página `/projetos/[id]`

**Risco:** A página já faz 2 queries (images + videos). Adicionar Productions
aumenta para 3 queries no carregamento.

**Mitigação:** Executar as 3 queries em paralelo com `Promise.all` (a estrutura
atual já permite isso).

### Risco 5: Migração em banco com dados existentes

**Risco:** O `ADD COLUMN IF NOT EXISTS production_id` pode falhar se o banco
tiver constraints ou triggers desconhecidos.

**Mitigação:** Usar `IF NOT EXISTS` e testar em uma cópia do banco de desenvolvimento
antes de rodar em produção. O script é idempotente — pode ser rodado múltiplas vezes.

---

## 10. Itens Explicitamente Adiados

Esta lista documenta o que foi considerado e conscientemente excluído do MVP.
Cada item pode entrar em versões futuras sem exigir refatoração do que foi implementado.

**Entidade e comportamento:**
- Planejador de Produção (geração automática de `production_brief`, pipeline)
- Cálculo de status derivado (Aberta, Em Produção, Em Revisão, Pronta, Publicada)
- Timestamps de milestone (`review_started_at`, `completed_at`, `published_at`, etc.)
- Produções derivadas (`source_production_id`)
- Edição de uma Production criada (título, intenção, tipo)
- Exclusão de Production pela UI (o banco suporta, a UI não expõe no MVP)
- Associação retroativa de drafts existentes a uma Production

**Tipos de Production:**
- `research`, `documentation`, `digital_product`, `automation` — não aparecem na UI
  do MVP (sem workspaces correspondentes)

**Navegação e UX:**
- "Produções recentes" no Dashboard global
- Entrada "Produções" na Sidebar global
- Busca e filtro de Produções por tipo ou data
- Workspace Pessoal (auto-criação de Projeto padrão)
- Badge com contagem de artefatos na lista de Produções

**Integração:**
- `images.production_id` — a tabela `images` fica sem FK para Production no MVP
- Vinculação de `video_drafts` à Production pela UI (schema suporta, UI não expõe)
- Vinculação de `posts` à Production pela UI (schema suporta, UI não expõe)
- Unificação do modelo de Assets (Imagem, LibraryFile, PostImage)

**Agentes:**
- Nenhum agente novo no MVP de Production
- O Image Evaluator continua funcionando exatamente como antes
- O Gerador de Prompt continua funcionando exatamente como antes

---

## 11. Decisões Arquiteturais — Status

### D.H.1 — Estrutura da rota ✅ RESOLVIDA

**Decisão:** Opção A — rota aninhada `/projetos/[projectId]/producoes/[productionId]`

O entry point de toda Produção é o Projeto no MVP. Sem Sidebar global de Produções
e sem Dashboard que liste Produções recentes, a rota global não oferece vantagem real.
A rota aninhada disponibiliza o `projectId` na URL gratuitamente (sem fetch extra para
breadcrumb) e reforça o modelo mental correto: Production vive dentro de um Projeto.

Quando uma rota global `/producoes/[id]` for necessária (Dashboard, Fase D), ela
será adicionada sem quebrar URLs existentes — basta criar a rota ou um redirect.

**Impacto no Incremento 4:** arquivo `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`

---

### D.H.2 — Campo `title` ✅ RESOLVIDA

**Decisão:** Título sugerido por truncagem simples da intenção, visível e editável
no formulário antes de salvar. Sem heurística linguística.

**Regra de sugestão (client-side, sem IA):**
```
title_suggestion = intention.slice(0, 60).trimEnd()
```
Sem interpretação, sem extração de substantivos, sem remoção de verbos iniciais.
Os primeiros 60 caracteres da intenção aparecem pré-preenchidos no campo `title`.
O usuário edita se quiser; se não editar, a sugestão é salva como título.

**Formulário resultante:**
```
Intenção *    [Criar posts semanais de educação financeira para jovens...]
              (ao sair do campo ↓)
Título        [Criar posts semanais de educação financei] ← editável
Tipo          [Editorial ▼]
[Criar Produção]
```

**Por que esta abordagem:**
Previsibilidade é garantida — o usuário sabe que o título será os primeiros 60
caracteres e pode ajustá-lo antes de salvar. A geração semântica de título
(por IA ou regras linguísticas) fica reservada para o Planejador de Produção (Fase C).

**Impacto no Incremento 3:** componente `production-form.tsx` com handler `onBlur`
na intenção que popula o título se estiver vazio.

---

### D.H.3 — Política de exclusão: FK `productions.project_id` ⚠️ EM DEFINIÇÃO

**Questão:** Qual deve ser o comportamento do banco quando um Projeto com Produções
é deletado?

#### Comparação das alternativas

**Alternativa 1 — `ON DELETE CASCADE`** *(plano original, descartado)*

O banco deleta automaticamente todas as Produções quando o Projeto é deletado.

```
DELETE projects WHERE id = X
→ DELETE productions WHERE project_id = X  (automático, sem aviso do banco)
→ SET image_drafts.production_id = NULL    (SET NULL — drafts preservados)
```

| Aspecto | Impacto |
|---------|---------|
| Segurança dos dados | Baixa — Produções deletadas sem recuperação possível |
| Complexidade na UI | Baixa — basta atualizar o texto do AlertDialog |
| Mecanismo de proteção | Apenas o AlertDialog (contornável por bug ou distração) |
| Reversibilidade | Zero — dado apagado sem backup existente |
| Alinhamento com a preferência do produto | Não — "Produções não devem ser apagadas silenciosamente" |

**Alternativa 2 — `ON DELETE RESTRICT`** *(recomendada)*

O banco bloqueia o DELETE do Projeto enquanto existirem Produções. O erro `23503`
é retornado e nenhum dado é alterado.

```
DELETE projects WHERE id = X
→ se EXISTS productions WHERE project_id = X:
    → erro 23503, operação abortada, banco inalterado
→ se não existir:
    → delete prossegue; imagens/drafts/posts apenas perdem o vínculo (SET NULL)
```

| Aspecto | Impacto |
|---------|---------|
| Segurança dos dados | Alta — impossível deletar acidentalmente |
| Complexidade na UI | Média — pré-check + dialog orientativo no Incremento 3 |
| Mecanismo de proteção | Duplo: banco (incontornável) + UI (orientativa) |
| Reversibilidade | Alta — política muda com 2 linhas de SQL sem afetar dados |
| Alinhamento com a preferência do produto | Sim — "o sistema deve preservar trabalho" |

**UX com RESTRICT:**
```
Usuário clica "Excluir Projeto"
→ UI busca COUNT(*) FROM productions WHERE project_id = X

Se count > 0:
  Dialog: "Este projeto tem 5 Produções.
           Para excluí-lo, primeiro exclua ou mova as Produções.
           [Ir para Produções] [Cancelar]"

Se count = 0:
  AlertDialog atual (texto atualizado):
  "As imagens, vídeos e publicações não serão excluídos —
   apenas perderão o vínculo com este projeto."
  [Excluir] [Cancelar]
```

**Alternativa 3 — Soft delete do Projeto**

O Projeto recebe `deleted_at` em vez de ser deletado. As Produções continuam
acessíveis via FK válida, mas o Projeto "desaparece" da interface.

| Aspecto | Impacto |
|---------|---------|
| Segurança dos dados | Alta |
| Complexidade na UI e queries | Alta — filtrar `WHERE deleted_at IS NULL` em todas as queries |
| Alcance das mudanças | Grande — afeta projetos/[id], sidebar, listas, queries de agentes |
| Prerequisito | Nenhum mecanismo de soft delete existe hoje no schema de `projects` |
| Conclusão | Fora do escopo do MVP |

**Alternativa 4 — Mover Produções para Workspace Pessoal antes da exclusão**

Antes de deletar o Projeto, o sistema migra automaticamente as Produções para o
"Workspace Pessoal" do usuário.

| Aspecto | Impacto |
|---------|---------|
| Segurança dos dados | Alta |
| Prerequisito | Workspace Pessoal deve existir (feature adiada em D4) |
| Conclusão | Indisponível no MVP. Pode ser adicionada quando Workspace Pessoal existir |

**Alternativa 5 — `ON DELETE SET NULL` em `productions.project_id`**

As Produções ficam com `project_id = NULL` quando o Projeto é deletado — "órfãs".

| Aspecto | Impacto |
|---------|---------|
| Segurança dos dados | Média — Produções preservadas mas sem contexto de Projeto |
| Conflito com o modelo | Viola a invariante I1: "toda Produção tem um Projeto" |
| Exigiria | Remover `NOT NULL` de `productions.project_id` |
| Conclusão | Incompatível com a decisão D4 de PRODUCTION_DECISIONS.md |

#### Recomendação

**`ON DELETE RESTRICT`** — Alternativa 2.

É a única opção que:
1. Preserva dados sem depender de features futuras (Workspace Pessoal, soft delete)
2. Tem proteção dupla: banco + UI
3. É facilmente reversível (2 linhas de SQL, sem perda de dados)
4. Não adiciona complexidade ao schema
5. Está alinhada com a preferência explícita do produto

A complexidade adicional no Incremento 3 (pre-check + dialog orientativo) é
proporcional ao benefício de não perder Produções acidentalmente.

**Nota sobre backup e recuperação:** A futura arquitetura de backup (soft delete,
lixeira, restauração de Projeto ou Produção) é desejada e registrada como evolução
futura. Ela não é premissa desta decisão — a escolha de RESTRICT é válida
independentemente de quando o módulo de backup existir.

**Status desta decisão:** Aguarda confirmação final antes do Incremento 1.

---

### D.H.4 — Tipos visíveis na UI do MVP ✅ RESOLVIDA

**Decisão:** Opção A — 3 tipos visíveis: `editorial`, `branding`, `campaign`

Os 4 tipos restantes (`research`, `documentation`, `digital_product`, `automation`)
estão no schema mas não aparecem na UI do MVP. Um tipo só aparece quando houver
ao menos um workspace funcional correspondente.

Os 3 tipos visíveis funcionam como classificação no MVP — sem prometer pipelines
automatizados distintos nesta fase. O comportamento do sistema é idêntico para
os três; a diferença é apenas a categorização do trabalho do usuário.

**Impacto no Incremento 3:** select com 3 opções no `production-form.tsx`, cada
uma com uma descrição de uma linha.

---

## Sumário dos Incrementos

**Status das decisões arquiteturais:**
- D.H.1 ✅ Rota aninhada `/projetos/[id]/producoes/[id]`
- D.H.2 ✅ Título = `intention.slice(0, 60)`, visível e editável no form
- D.H.3 ⚠️ FK `ON DELETE RESTRICT` — aguarda confirmação final
- D.H.4 ✅ 3 tipos: editorial, branding, campaign

| # | Nome | Escopo principal | Arquivos novos | Arquivos modificados | Depende de |
|---|------|-----------------|---------------|---------------------|-----------|
| 1 | Schema | Tabela + colunas | `020_create_productions.sql` | `lib/types.ts` | D.H.3 confirmada |
| 2 | API | Routes CRUD | `api/productions/route.ts`, `api/productions/[id]/route.ts` | — | Incremento 1 |
| 3 | Lista + Criação | Tab Produções no Projeto | `components/productions/production-form.tsx` | `projetos/[id]/page.tsx` | Incremento 2 |
| 4 | Detalhe | Página da Production | `projetos/[id]/producoes/[productionId]/page.tsx` | `projetos/[id]/page.tsx` | Incremento 3 |
| 5 | Vinculação | Draft com production_id | — | `imagens/page.tsx`, `api/image-drafts/route.ts` | Incremento 4 |

Cada incremento pode ser autorizado, implementado e testado de forma independente.
O próximo incremento só deve começar após o anterior estar funcionando em ambiente
de desenvolvimento.

---

*Este documento encerra a fase de descoberta conceitual. Os próximos documentos
serão gerados pela própria implementação: diffs, changelogs e atualização do
ARCHITECTURE.md com o estado pós-Fase B.*

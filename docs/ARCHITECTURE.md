# Content Agent Studio — Arquitetura do Sistema
**Fase 2 · Documento de Referência · Junho 2026**

> Este documento foi construído inteiramente a partir da leitura do código atual.
> Cada afirmação é rastreável até um arquivo específico.

---

## 1. Estado Atual do Sistema

O sistema é uma aplicação web funcional de criação de conteúdo assistida por IA. Ele opera em produção com autenticação real, banco de dados, armazenamento de arquivos e integrações com duas APIs de geração de imagem.

**Stack de produção:**
- **Frontend + API:** Next.js 16.2 (App Router, React 19)
- **Banco de dados + Auth:** Supabase (PostgreSQL + RLS + `auth.users`)
- **Armazenamento de arquivos:** S3-compatível via `@aws-sdk` (configurável por variáveis de ambiente)
- **Processamento de imagens:** `sharp` (thumbnails em servidor)
- **UI:** Radix UI + Tailwind CSS v4 + shadcn/ui

**Integrações de IA:**
- OpenAI API (`gpt-3.5-turbo`, `gpt-4o-mini`, `gpt-image-2` e variantes)
- NanoBanana API (geração assíncrona com webhook callback)

---

## 2. Arquitetura Existente

### 2.1 Visão Geral em Camadas

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER (React)                                            │
│  Pages: /imagens  /videos  /posts  /arquivos  /projetos     │
│  /galeria  /dashboard  /configuracoes                       │
└───────────────────────┬─────────────────────────────────────┘
                        │ fetch() — chamadas client → API Routes
┌───────────────────────▼─────────────────────────────────────┐
│  NEXT.JS API ROUTES (server-side — chaves privadas aqui)    │
│  /api/openai/generate-image                                 │
│  /api/evaluate-image                                        │
│  /api/prompts/translate                                     │
│  /api/nanobanana/generate  /callback  /status/:taskId       │
│  /api/posts/generate-feed-text                              │
│  /api/videos/generate-scene-prompt                          │
│  /api/image-drafts  /api/video-drafts  /api/posts           │
│  /api/storage/upload-image  /presign-image-upload           │
│  /api/library-files  /api/library-folders                   │
│  /api/images/:id/signed-url                                 │
└──────┬──────────────────┬────────────────────────┬──────────┘
       │                  │                        │
┌──────▼──────┐  ┌────────▼────────┐  ┌───────────▼──────────┐
│  SUPABASE   │  │  OpenAI API     │  │  S3-compatible        │
│  PostgreSQL │  │  NanoBanana API │  │  object storage       │
│  + Auth     │  │                 │  │  (via Sharp)          │
│  + RLS      │  └─────────────────┘  └──────────────────────┘
└─────────────┘
```

### 2.2 Padrão de Segurança para API Keys

As chaves de API **nunca chegam ao cliente** para fazer chamadas externas. O fluxo é:

1. Page client busca configurações do usuário no Supabase (incluindo chaves)
2. Usa as chaves **apenas para saber se recursos estão disponíveis** (ex: mostrar botão NanoBanana)
3. Toda chamada real às APIs externas passa pelas API Routes do Next.js (server-side)
4. As API Routes buscam a chave do `user_settings` no Supabase + fallback para `process.env`

### 2.3 Estrutura de Arquivos

```
app/
  (dashboard)/          # Layout autenticado com sidebar
    imagens/page.tsx    # Workspace principal de geração de imagens (~1275 linhas)
    videos/page.tsx     # Editor de storyboard/cenas
    posts/page.tsx      # Criação de posts para redes sociais
    arquivos/page.tsx   # Biblioteca de arquivos
    galeria/page.tsx    # Galeria de imagens aprovadas
    projetos/
      page.tsx          # Lista de projetos
      [id]/page.tsx     # Detalhes do projeto
    configuracoes/page.tsx
    dashboard/page.tsx
  api/                  # Todas as rotas server-side
lib/
  ai-simulator.ts       # Lógica de geração de prompt + integração NanoBanana
  types.ts              # Todas as interfaces TypeScript do domínio
  storage/s3.ts         # Abstração S3 (upload, presign, thumbnail, delete, move)
  supabase/
    client.ts           # Cliente browser
    server.ts           # Cliente server (SSR/API Routes)
    middleware.ts        # Auth middleware
scripts/
  001–019_*.sql         # Migrations sequenciais — fonte de verdade do schema
components/
  images/               # ImageInputSection, PromptSection, ImageResult, GenerationHistory
  videos/               # SceneCard, StoryboardModal
  projects/             # ProjectForm, ProjectList
  layout/               # Header, Sidebar
  ui/                   # Componentes shadcn/ui
```

---

## 3. Modelo de Domínio

O domínio gira em torno de um conceito central: **o Projeto como contexto semântico** que orienta toda geração de conteúdo.

```
User
 └─── Project (contexto + estilo + evaluation_mode)
        ├─── Image (geradas e aprovadas)
        ├─── Video (storyboard de cenas)
        ├─── Post (publicações para redes sociais)
        └─── LibraryFolder
               └─── LibraryFile (qualquer arquivo)

User
 ├─── ImageDraft (workspace de trabalho em progresso)
 │      └─── GenerationAttempt[] (histórico de tentativas com avaliações)
 ├─── VideoDraft (storyboard em progresso)
 ├─── GenerationTask (jobs assíncronos NanoBanana)
 ├─── Prompt (histórico de prompts salvos)
 └─── UserSettings (configuração + API keys)
```

**Conceito central não explícito:** O **Workspace** de uma sessão de criação. O `ImageDraft` atua como workspace persistente: guarda todo o estado intermediário de uma sessão de trabalho (input do usuário, prompt gerado, tentativas, avaliações, modelo selecionado, projeto associado). Não é apenas um "rascunho" — é a memória de uma sessão de criação.

---

## 4. Entidades Principais

### Project
**Arquivo:** `lib/types.ts:3`, `scripts/001_create_tables.sql`, `scripts/019_add_project_evaluation_mode.sql`

| Campo | Tipo | Papel |
|-------|------|-------|
| `name` | string | Identificador humano |
| `description` | string | Contexto público |
| `context` | string | **Instrução para IA** — inserida em todos os prompts |
| `style_profile` | string | **Perfil estético** — texto livre para guiar estilo visual |
| `evaluation_mode` | enum | Critério de avaliação: `default | conceptual | aesthetic | commercial | experimental` |
| `status` | enum | `active | archived` |

O `evaluation_mode` é o conceito mais sofisticado: ele muda o comportamento dos agentes de geração de prompt E avaliação de imagem.

### ImageDraft (Workspace)
**Arquivo:** `lib/types.ts:205`, `scripts/002_create_drafts_tables.sql`, `scripts/008–011_*.sql`

Entidade mais complexa do sistema. Representa uma sessão de criação em andamento:

| Campo | Papel |
|-------|-------|
| `user_input` | Intenção original do usuário |
| `generated_prompt` | Prompt em inglês gerado pela IA |
| `generated_prompt_pt` | Tradução PT-BR do prompt |
| `prompt_details` | `{style, lighting, composition}` — detalhes extraídos |
| `generation_attempts[]` | Histórico de tentativas com avaliações |
| `current_evaluation` | Última avaliação do ImageEvaluator |
| `current_attempt` | Número da tentativa atual (max configurável) |
| `current_image_id` | Referência à Image aproveitada |
| `image_status` | `draft | generating | approved | rejected` |
| `auto_mode` | Se pipeline é automático |
| `selected_model` | Modelo escolhido para esta sessão |
| `workspace_state` | Estado serializado adicional (script 010) |

**Auto-save:** debounce de 800ms — qualquer mudança de estado dispara um PATCH no draft.

### Image
**Arquivo:** `lib/types.ts:58`, `scripts/001_create_tables.sql`, `scripts/013_add_storage_metadata.sql`

Representa uma imagem **gerada e persistida**. Ciclo: `draft → generating → approved | rejected`.

Campos de storage: `image_url`, `storage_path`, `thumbnail_url`, `thumbnail_path`, `storage_provider`, `file_size`, `mime_type`.

### GenerationTask
**Arquivo:** `scripts/005_create_generation_tasks.sql`

Tabela de controle de jobs assíncronos. Criada quando NanoBanana é acionado. O webhook da NanoBanana atualiza via `service_role` (bypass de RLS).

### Post
**Arquivo:** `lib/types.ts:114`, `scripts/012_create_posts.sql`, `scripts/014_add_post_images.sql`

Publicação para redes sociais. Suporta múltiplas imagens (`PostImage[]`). Channels: `instagram_post | instagram_story | youtube_post | youtube_shorts | youtube_video`.

### UserSettings
**Arquivo:** `lib/types.ts:18`, `scripts/003–009_*.sql`

Configuração global do usuário. Contém:
- API keys (OpenAI, Replicate, NanoBanana)
- Preferências de modelo padrão
- Toggle do avaliador + número máximo de refinamentos
- Toggle de automação (modo que encadeia prompt → imagem automaticamente)

---

## 5. Fluxos Existentes

### Fluxo 1: Geração de Imagem (Manual, OpenAI)

```
[User Input] → handleGeneratePrompt()
    → lib/ai-simulator.generateImagePrompt()
        → tenta OpenAI (gpt-3.5-turbo) com contexto do projeto
        → fallback: generateSimulated() (determinístico)
    → salva Prompt no banco
    → [prompt displayed]
→ handleCreateImage()
    → POST /api/openai/generate-image
        → busca chave em user_settings || env
        → POST OpenAI Images API
        → se b64_json: uploadImageToS3() + thumbnail
        → retorna imageUrl (presigned se S3)
    → salva Image no banco (status: 'draft')
    → setCurrentImage(), setImageUrl()
→ [Image displayed]
→ handleApprove() → UPDATE images SET status='approved'
```

### Fluxo 2: Geração de Imagem (NanoBanana — Assíncrono)

```
[User Input] → handleGenerateNanoBanana()
    → POST /api/nanobanana/generate
        → POST NanoBanana API → retorna taskId externo
        → salva GenerationTask (status: 'processing')
        → retorna taskId interno
    → POLLING: GET /api/nanobanana/status/:taskId (a cada 5s, max 60x)
        → quando completed:
            → POST /api/storage/upload-image (busca URL externa → sobe para S3)
            → saveGeneratedImageRecord()
            → recordGenerationAttempt()
    OU
    → WEBHOOK: POST /api/nanobanana/callback
        → atualiza GenerationTask via service_role
        → frontend percebe na próxima poll
```

### Fluxo 3: Auto Mode

```
[User Input] + autoMode=true + automationEnabled=true
    → handleGeneratePrompt() → resultado
    → handleCreateImageWithModel(defaultImageModel) [encadeado automaticamente]
```

`autoMode` sozinho (sem `automationEnabled`) usa sempre OpenAI. Com `automationEnabled`, usa o modelo padrão configurado (pode ser NanoBanana).

### Fluxo 4: Ciclo de Avaliação e Refinamento

```
[Imagem gerada] → handleEvaluateImage()
    → POST /api/evaluate-image
        → OpenAI gpt-4o-mini com vision (image_url)
        → systemPrompt varia por evaluation_mode
        → retorna: { score, approved, feedback, improvements[], refinedPrompt }
    → setCurrentEvaluation()
    → registra GenerationAttempt com evaluation
    → [UI mostra score, feedback, opção de refinar]
→ handleUseRefinedPrompt(refinedPrompt)
    → setGeneratedPrompt(refinedPrompt)
    → setCurrentAttempt(prev + 1)
    → [usuário clica "Criar Imagem" novamente]
```

O sistema não faz loop automático de avaliação + regeneração: o usuário decide aceitar o prompt refinado. A estrutura para loop automático existe em `lib/ai-simulator.ts:intelligentGenerationLoop` mas não está wired.

### Fluxo 5: Criação de Post

```
[Descrição + Canal + Projeto]
    → POST /api/posts/generate-feed-text
        → sistema de instrução por canal (instagram_post, youtube_video, etc.)
        → OpenAI gpt-4o-mini → texto formatado pronto para publicar
    → upload de imagem via presigned URL
    → salva Post no banco (status: 'draft' | 'saved')
```

### Fluxo 6: Storyboard de Vídeo

```
[Cenas: {description, duration, movement}]
    → handleGenerateScenePrompt(cena, número)
        → POST /api/videos/generate-scene-prompt
            → OpenAI → prompt de produção para a cena
    → [cenas com prompts gerados]
→ handleGenerateVideo() → SIMULADO (setTimeout 3s)
```

A geração de vídeo real **não está implementada**. A interface está preparada mas o botão "Gerar Vídeo" simula um timeout.

### Fluxo 7: Biblioteca de Arquivos

```
[Upload de arquivo pelo usuário]
    → POST /api/storage/presign-image-upload → uploadUrl (S3 presigned PUT)
    → cliente faz PUT direto no S3 (bypass do servidor)
    → POST /api/library-files → salva metadados no banco
→ [Navegação por pastas (LibraryFolder)]
    → suporte a soft-delete (deleted_at)
    → download via /api/library-files/:id/download → presigned GET
```

---

## 6. Agentes Existentes ou Implícitos

O sistema não usa a palavra "agente" internamente, mas cinco comportamentos de agente estão claramente implementados:

### Agente 1: Gerador de Prompts
**Arquivo:** `lib/ai-simulator.ts:generateImagePrompt()`, `lib/ai-simulator.ts:generateWithOpenAI()`

**Comportamento:** Recebe `userInput + projectContext + styleProfile + evaluationMode` → retorna prompt estruturado em inglês, pronto para geração de imagem.

**Fallback:** Quando sem API key, usa lógica determinística baseada em keywords (`generateSimulated()`).

**Consciência do evaluation_mode:** Sim — o systemPrompt muda completamente conforme o modo.

### Agente 2: Avaliador de Imagens (Image Evaluator)
**Arquivo:** `app/api/evaluate-image/route.ts`

**Comportamento:** Recebe imagem (URL) + prompt + contexto + evaluation_mode → retorna `{ score: 0-100, approved: bool, feedback: string, improvements: string[], refinedPrompt: string }`.

**Capacidade:** Vision (multimodal). Usa `gpt-4o-mini` com `image_url.detail: 'low'`.

**Consciência do evaluation_mode:** Sim — o systemPrompt define critérios diferentes por modo (conceptual vs aesthetic vs commercial vs experimental).

**Regra importante capturada no prompt:** "Uma imagem bonita NÃO deve ser bem avaliada se for conceitualmente fraca, exceto quando modo não prioriza conceito."

### Agente 3: Tradutor de Prompts
**Arquivo:** `app/api/prompts/translate/route.ts`

**Comportamento:** Recebe prompt em inglês (linguagem de IA) → retorna tradução natural em português brasileiro. Preserva termos técnicos de fotografia/cinema.

**Modelo:** `gpt-4o-mini`, temperature 0.2 (determinístico).

### Agente 4: Gerador de Texto para Feed
**Arquivo:** `app/api/posts/generate-feed-text/route.ts`

**Comportamento:** Recebe `{ nome, canal, descrição, aiContext, projectId }` → retorna texto formatado e pronto para publicar conforme o canal (Instagram/YouTube).

**Consciência do canal:** Sim — há instruções de formato distintas para cada tipo de publicação.

**Usa contexto do projeto:** Sim — busca `name, description, context, style_profile` do projeto associado.

### Agente 5: Gerador de Prompt de Cena
**Arquivo:** `app/api/videos/generate-scene-prompt/route.ts`

**Comportamento:** Recebe descrição da cena + metadados (duração, movimento, nome do vídeo) → retorna prompt técnico de produção de vídeo.

### Agente 6: Worker Assíncrono NanoBanana (infraestrutural)
**Arquivo:** `app/api/nanobanana/generate/route.ts`, `app/api/nanobanana/callback/route.ts`

**Comportamento:** Orquestra a geração assíncrona — submete job, persiste `GenerationTask`, recebe webhook com resultado. Usa `service_role` Supabase para bypass de RLS no callback.

---

## 7. Artefatos Persistentes

### No Banco de Dados (Supabase)

| Tabela | Dados | Lifecycle |
|--------|-------|-----------|
| `projects` | Projetos com contexto e estilo | Permanente |
| `images` | Imagens geradas + metadados de storage | Permanente |
| `image_drafts` | Workspace de sessão de criação | Muda constantemente via auto-save |
| `video_drafts` | Storyboard em progresso | Auto-save |
| `videos` | Vídeos finalizados | Permanente (geração simulada) |
| `posts` | Publicações para redes sociais | Permanente |
| `prompts` | Histórico de prompts gerados | Acumulativo |
| `generation_tasks` | Jobs NanoBanana | Transitório (permanece após conclusão) |
| `library_files` | Metadados de arquivos da biblioteca | Permanente (soft-delete) |
| `library_folders` | Estrutura de pastas da biblioteca | Permanente |
| `user_settings` | Configuração + API keys | Permanente, 1 por usuário |

### No S3 (armazenamento de objetos)

**Estrutura de paths:**
```
users/{userId}/images/{uuid}/original.{ext}
users/{userId}/images/{uuid}/thumb.webp
users/{userId}/posts/{uuid}/original.{ext}
users/{userId}/posts/{uuid}/thumb.webp
users/{userId}/library/{prefixo}/{uuid}/{nome}.{ext}
users/{userId}/library/{prefixo}/.keep  (placeholder de pasta)
```

**Controle de acesso:** URLs públicas para arquivos de biblioteca. Presigned URLs (1h) para imagens privadas. Thumbnails sempre gerados via `sharp` (360px WebP quality 55).

---

## 8. Pontos Fortes da Arquitetura

### 8.1 Projeto como contexto semântico
O `Project` não é apenas um agrupador. Ele carrega `context` (instrução de IA), `style_profile` (perfil estético), e `evaluation_mode`. Isso significa que a mesma intenção do usuário produz resultados diferentes dependendo do projeto selecionado — o projeto amplifica e direciona a IA.

### 8.2 Agentes conscientes do evaluation_mode
Tanto o Agente 1 (gerador de prompts) quanto o Agente 2 (avaliador) recebem `evaluation_mode` e mudam seu comportamento. Isso cria coerência no pipeline: o prompt gerado já está alinhado com o critério de avaliação que será usado.

### 8.3 Workspace persistente como memória de sessão
O `ImageDraft` persiste o estado completo da sessão — input, prompt, tentativas, avaliações, modelo — não apenas o resultado. Isso permite retomar exatamente onde parou, visualizar a evolução das tentativas, e usar avaliações anteriores como contexto.

### 8.4 Separação segura de API keys
As chaves nunca são usadas diretamente no cliente para chamadas externas. O padrão "cliente sabe que tem chave, servidor usa a chave" está consistentemente aplicado.

### 8.5 Storage agnóstico de provider
`lib/storage/s3.ts` funciona com qualquer endpoint S3-compatível (Tigris, Cloudflare R2, MinIO, AWS). A configuração é via env vars com fallback gracioso (retorna `null` se não configurado).

### 8.6 Migrations sequenciais como fonte de verdade
Os 19 scripts SQL numerados documentam a evolução do schema. É possível reconstruir todo o banco apenas rodando os scripts em ordem.

### 8.7 RLS em todas as tabelas
Todas as tabelas têm Row Level Security habilitado com políticas por `user_id`. A única exceção intencional é o callback NanoBanana, que usa `service_role` por necessidade arquitetural (o webhook vem de fora sem contexto de usuário).

---

## 9. Pontos de Atenção

### 9.1 `app/(dashboard)/imagens/page.tsx` — Deus Componente
Este arquivo tem ~1275 linhas e acumula:
- Estado de UI (loading states, refs para scroll)
- Lógica de negócio (ciclo generate → evaluate → refine)
- Orquestração de API calls (prompt → image → evaluate → save)
- Persistência (draft save/load, polling)
- Gerenciamento de URLs (signed URLs, data URLs, S3 paths)

Este é o arquivo de maior risco para manutenção e evolução.

### 9.2 `lib/ai-simulator.ts` — Nome conflitante com responsabilidade real
O arquivo se chama "simulator" mas contém código de produção real (cliente NanoBanana, chamadas OpenAI). Também contém scaffolds não implementados (`intelligentGenerationLoop`, `sendToWebhook`, `processWebhookResponse`). A mistura de código de produção, fallback de simulação e scaffolds não implementados cria confusão sobre o que é real.

### 9.3 Polling NanoBanana no cliente sem cleanup
`handleGenerateNanoBanana()` usa recursão assíncrona com `setTimeout(5000)` por até 60 iterações (5 minutos). Se o componente desmontar durante o polling, não há cancelamento. Pode gerar state updates em componentes desmontados.

### 9.4 Loop de avaliação não automatizado
A estrutura para refinamento iterativo existe (tentativas, `currentAttempt`, `maxRefinements`), mas o loop não é automático. O usuário precisa clicar manualmente para aceitar o prompt refinado e gerar novamente. O `intelligentGenerationLoop` em `ai-simulator.ts` é um placeholder.

### 9.5 Geração de vídeo é simulação pura
`handleGenerateVideo()` faz apenas um `setTimeout(3000)` e exibe um toast. A tabela `videos` existe com schema correto, mas o caminho de geração real não está implementado. O módulo de vídeo está completo apenas em storyboard/planejamento.

### 9.6 Biblioteca e Galeria são mundos separados
Imagens geradas (`images` table) e arquivos da biblioteca (`library_files`) são entidades desconectadas. Não há caminho para mover uma imagem gerada para a biblioteca, ou usar um arquivo da biblioteca como referência em geração.

### 9.7 Posts não referenciam Images geradas
A entidade `Post` tem seu próprio campo `image_url` e `PostImage[]`. Não há FK para a tabela `images`. Uma imagem aprovada na galeria não pode ser facilmente vinculada a um post sem re-upload.

### 9.8 `style_profile` é texto livre sem schema
É um dos conceitos mais importantes da plataforma (guia toda geração de imagem), mas é uma string sem estrutura. Não há validação, template ou orientação sobre o que escrever. Isso limita a efetividade e torna difícil para novos usuários usarem bem.

### 9.9 Histórico de `generation_tasks` nunca é limpo
A tabela `generation_tasks` acumula permanentemente. Não há TTL, soft-delete, ou limpeza automática. A longo prazo isso cresce sem limite.

### 9.10 `user_settings` lida com `replicate_api_key` mas Replicate não está implementado
O campo existe no banco e na UI, mas `lib/ai-simulator.ts` explicitamente lança `throw new Error('Replicate integration not yet implemented')`. É uma promessa não cumprida exposta ao usuário.

### 9.11 Auto-save com `beforeunload` pode não executar em mobile
O auto-save faz `window.addEventListener('beforeunload', ...)` que é não-confiável em mobile (Safari especialmente ignora). Sessões podem ser perdidas em dispositivos móveis.

### 9.12 Duplicação da lista de modelos de imagem
O conjunto de modelos válidos aparece em três lugares: `lib/types.ts` (union type), `app/api/openai/generate-image/route.ts` (Set), e `app/(dashboard)/imagens/page.tsx` (função `normalizeImageModel`). Uma mudança de modelos exige atualização nos três.

---

## 10. Questões para Responder Antes de Evoluir

### Sobre o Produto

1. **Qual é a jornada alvo do usuário?** O fluxo imagem → avaliação → refinamento manual está correto, ou deveria ser automático (loop até aprovação)?

2. **O `style_profile` deve virar estruturado?** (campos: paleta, referências visuais, proibições, etc.) Ou o texto livre é intencional?

3. **A Galeria deve ser o destino final de toda imagem aprovada?** Hoje imagens aprovadas ficam na tabela `images` mas Posts têm seu próprio storage de imagens.

4. **Vídeo é prioridade na Fase 2?** Se sim, qual provider de geração? Se não, o módulo pode ser temporariamente desativado para simplificar.

5. **A Biblioteca de Arquivos tem um papel de workflow** (ex: usar assets da biblioteca como referência para geração?) ou é apenas um gerenciador de arquivos?

6. **Posts deveriam ser criados a partir de imagens da galeria,** ou são sempre criados independentemente?

### Sobre a Arquitetura

7. **O ImageDraft deve ser a entidade central** (workspace que eventualmente "publica" em Image + Post), ou imagem e post são criados em fluxos separados?

8. **O loop de avaliação deve ser automático?** Qual é o critério de "aprovação automática"? Score mínimo? evaluation_mode específico?

9. **Como múltiplas abas/sessões simultâneas devem se comportar?** Hoje o draft é por usuário sem controle de concorrência.

10. **As API keys devem ser movidas para o servidor** (configuração de admin), ou o modelo "cada usuário traz sua chave" é intencional para o produto?

11. **O `generation_tasks` deve ter TTL?** Qual o valor de manter o histórico de jobs completos/falhos indefinidamente?

12. **O Agente Gerador de Prompts deve ser exposto como uma etapa separada visível?** Hoje ele é transparente (roda sem o usuário ver). Torná-lo explícito (ex: "prompt sugerido pela IA, você aprova?") mudaria o produto.

---

## Apêndice: Mapa de Migrations → Features

| Migration | Feature |
|-----------|---------|
| 001 | Core: projects, images, prompts, videos |
| 002 | Drafts: image_drafts, video_drafts |
| 003/003v2 | user_settings |
| 004 | nanobanana_api_key em user_settings |
| 005 | generation_tasks (jobs assíncronos) |
| 006a | automation_enabled em user_settings |
| 006b | prompt_translations em image_drafts |
| 007 | default_model mudou para 'gpt-image-2' |
| 008 | draft_model (selected_model em image_drafts) |
| 009 | image_evaluator_enabled + max_refinement_iterations |
| 010 | workspace_state em image_drafts |
| 011 | current_image_id em image_drafts |
| 012 | posts |
| 013 | campos de storage em images (storage_path, thumbnail, etc.) |
| 014 | post_images (array de imagens por post) |
| 015 | library_files |
| 016 | library_folders |
| 017 | is_project_root em library_folders |
| 018 | soft-delete em library_files (deleted_at) |
| 019 | evaluation_mode em projects |

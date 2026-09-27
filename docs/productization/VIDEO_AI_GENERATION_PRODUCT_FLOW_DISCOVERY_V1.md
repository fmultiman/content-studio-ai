# Discovery: Video AI Generation Product Flow V1

## FACTUAL CURRENT STATE

### 1. Worktree & Git
- **Origem Factual**: Repositório canônico local (`D:\Trabalhos\Content Agent Studio\content-studio-ai-git`).
- **Branch**: `discovery/video-ai-generation-product-flow-v1`.
- **Starting SHA Factual**: O clone original local apontava para `40198f1`, mas a base correta foi estabelecida nesta discovery usando um reset efetivo.
- **Base SHA Efetiva e Confirmada**: `77320afc31c787ae3d7c6930ea35049b6038d430` (Project Identity Visual Tokens closure proof). Todos os checkouts foram validados para constatar ancestralidade exata à main sem adulterações.
- **Estado do Creative Editor**: A worktree `traycer-witty-puma...` permanece intocada.
- **Preservação da Modificação Estrangeira (VIDEO_AUDIO_AUTHORING_V1.md)**: Confirmado que a alteração foi preservada perfeitamente na base original de seu respectivo commit `a34ba61`. Nenhuma restauração ou cópia desnecessária foi executada nesta discovery.

### 2. Arquitetura Factual de `Production` (Entry Points)
A interface Production (`app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`) atualmente despacha as ações de criação de forma assimétrica:

**Criar Imagem:**
- Função/Ação: Botão `Criar Imagem` despacha via Link Navigation (`router.push`).
- Rota Destino: `/imagens`
- Query Params: `?project=X&production=Y`.
- Resultado: O usuário entra no workspace seguro e contextual; nenhuma entidade é suja no banco antecipadamente.

**Criar Vídeo:**
- Função: `createVideoDraftForCreativeEditor()`.
- API Call: `POST /api/video-drafts` silencioso via fetch.
- Rota Destino: Redirect pro authoring (`/creative-editor/video/[draftId]`).
- Resultado: Um VideoDraft (com scene dummy) é forçosamente inflado sem o consentimento direto de uso real, transformando qualquer clique num ativo no banco de Authoring. O V1 deverá suprimir esta chamada em favor de roteamento análogo ao da imagem.

### 3. Arquitetura Factual de `/imagens` (Storage e Durabilidade)
A auditoria no fluxo completo (`/api/nanobanana/generate`, poller do Frontend, `/api/nanobanana/callback` e storage API) confirmou o seguinte pipeline factual:

- **Provider Result**: Retorna task Id.
- **Async Feedback**: O provedor envia via **Webhook** a completion string pro Back-end (`/api/nanobanana/callback`).
- **Local Storage / Download**: O Client (`polling`) detecta o completion. O **Frontend** pega a `image_url` remota transitória e manda para `POST /api/storage/upload-image`. O servidor de Storage **baixa em memória os Buffers do asset** e copia para o Storage próprio (S3 provedor ou Supabase Bucket), pasta genérica `images`.
- **Durabilidade Tabela (`images`)**: A API Storage retorna as novas S3 presigned URLs, que são escritas definitivamente pela UI na entidade isolada da tabela `images` isolada ao draft.
- **LibraryFile Lifecycle**: **Nenhuma** LibraryFile é criada. O status é `draft` ou `approved`. O fluxo é *transiente* porque "approved" na Galeria apenas sinaliza validade, a promoção a mídia reaproveitável (LibraryFile) não é implícita.

### 4. Arquitetura Factual de `generation_tasks`
- **Schema & Migrations**: Tabela introduzida em `005_create_generation_tasks.sql` com colunas genéricas para track de payload. Sem dependências complexas (Foreign keys aplicam apenas a User e Project).
- **Entidade Factual**: É uma tabela puramente transiente/ephemeral (fila de processamento). 
- **Campos**: Contém `prompt`, `image_url`, `aspect_ratio`.
- **Ownership e Relações Físicas**: Possui relação apenas hierárquica base (Project/User), NENHUMA amarração estrita FK com `images` ou `library_files`. O link é reverso/sujeccional nas entities (não no DB schema). Os `generation_attempts` do frontend enviam metadados independentes.
- **Veredicto de Reutilização**: **Opção B (generation_tasks genérica + entidade video_generations)**. Com adição mínima ou convivência contextual (usar fallback JSONB ou alterar `image_url` string polimorficamente via aplicação/migration leve pra `result_url`). A `generation_tasks` lida perfeitamente com a interface do queueing manager, não devendo deter metadado profundo de vídeo, cabendo a tabela canônica `video_generations` registrar a autoridade de estado e atributos audiovisuais, em vez de contaminar a track table com parâmetros densos de I2V.

### 5. Arquitetura Factual de `/videos` (Draft Hub)
- A tela `app/(dashboard)/videos/page.tsx` hoje processa via `buildVideoDraftHubCards()` a tabela legada. Trata-se puramente de um Hub Histórico.
- O workspace (Legacy Timeline) já foi bloqueado logicamente (redireciona em proxy.ts `legacyTarget`).
- Os botões (ex: "Abrir") mandam pro Native Creative Editor. "Preparar Publicação" chama um modal desatrelado.
- **Veredicto para UX**: Remover a lógica limitadora em `createVideoDraftForCreativeEditor`. Adicionar o Workspace Generativo no header da tela, preservando a atual listing grid como `Históricos` intactos embaixo, sem degradar compatibilidade (a listagem consome `video_drafts` sem interferência na tela geradora nova que alimentará uma state paralela de I2V provisória). Permitir entrada através da hierarquia de query params de Production.

### 6. Arquitetura Factual do Video Evaluator
Auditoria factual sobre infraestrutura local para Evaluation sem custos excessivos de ffmpeg customizados:
1. Native Video Understanding é experimental (Gemini 1.5/GPT-4o vision long timeout/rate limits altos).
2. Sampled-Frame submete chunks estáticos, demandando lambda server-side cut tools para não travar main threads Node.
- **Veredicto**: **C - Sem evaluator no V1**. A premissa do I2V (Imagem ao Vídeo) garante que qualquer base gerada já passou exaustivamente pelo Image Evaluator. Prover um evaluation sobre o resquício temporal agora consome esforço vertical que atrasará o verdadeiro delivery clip (Value Proposition). O clip obtido passa visualização humana final pra Descarte rápido em UI.

---

## EXTERNAL PROVIDER FACTS

Inventário Local Repo: 
- `user_settings` possuem campos para api keys da OpenAI, NanoBanana (ambas ativas) e `replicate_api_key` rotulada de `futuro`/inativa. Não existem APIs ativas de geração em vídeo consumidas.

Inventário Factual Provedores V1 (via tracking documental API):
- **RunwayML Gen-3 Alpha API**: Permite Text-to-Video e Image-to-Video (First Frame ou Last Frame condition). Duração base de 5 ou 10s. Fornece webhook ou polling (`GET /v1/tasks/{id}`). Expiram resultados na CDN oficial (URLs AWS) velozmente, endossando severamente nosso design de download S3 interno de salvamento em callback.
- **Luma Dream Machine API**: API consolidada (T2V/I2V), suporta motions intensos. Sistema fluente de Webhook (`callback_url`), extend capabilities, keys idencionais. 
- **Minimax ou Kling via Replicate**: Baseia-se no webhooks contratuais unificados da Replicate. Polling sobre 'predictions'.
- **Recomendação de Produto**: **Runway Gen-3 ou Luma Dream Machine** como base inicial para I2V. Runway recentemente liberou image-inputs nativo robustos por endpoint API fáceis acopláveis à semântica do `NanoBanana` (Task Submit -> Polling status -> Download output endpoint).

---

## DECISIONS

### I2V vs T2V (Revalidação Factual)
Image-to-Video permanece a escolha definitiva por vantagem técnica:
- O T2V (Text-to-Video) requer refinamento estético exaustivo, algo que em T2I foi sanado usando o `Project Identity Visual Tokens`. Como as APIs atuais carecem de formatação complexa multimodal no prompt em plain video creation, submeter a imagem provada e revalidada pelo Evaluator à malha de animação I2V impede desperdício de tokens, protege custos de geração, minimiza a frustração latente no usuário e unifica as duas features (Galeria de Imagens atuará como base semântica valiosa pre-requisito).

### Async Model Verdict
**Hybrid Strategy (Webhook Core + Polling UI)**
- A integridade usa webhook (Provider manda completude para `callback` API alterando `generation_tasks`).
- A aplicação usa Polling. O frontend, para evitar refatorações via websockets Sockets.io pesadas no stack `app-router`, continua lendo o próprio banco do backend. Isso abstrai perdas na aba fechada (pois o callback salvou o resultado de forma isolada, não dependendo do loop cliente). Padrão comprovado funcional implementado na `images/page.tsx` hoje mesmo.

### Library Lifecycle Verdict
**Transient -> Provider Result Durable na tabela -> Explicit Save**
1. O vídeo desponta concluído sendo feito download no S3 local e listado em Tabela de Criações (não em LibraryFile nativo).
2. Como uma Image, aguarda Descarte ou promoção ("Aprovação") do UX que carimbará o hard link (Entity Clone) para `library_files`. Isto evita poluir o Workspace Core e mantem authority duradoura sobre o ciclo do V1 idêntico. 

### Creative Editor Bridge
A interseção real ocorrerá quando um Artifact promovido via UX pra **`LibraryFile`** (Salvamento Formal).
O Creative Editor lê livremente hoje da pasta de root `assets`/Media Library do projeto. Assim que a Entity ingressa lá, ela já é perfeitamente viável sem criar abstrações forçadas do vídeo dentro do Draft prematuramente. 
Ação proposta na UI futura: *Drop-down do gerado `->` Adicionar à Library*.

### Schema Verdict
- Tabela existente `generation_tasks` recebe pequeno ajuste (via migração ex: `039`) renomeando `image_url` logicamente (ex. adicionando fallback JSON `result_metadata`) para suportar a ressonância limpa das queries da fila.
- Nova Tabela Estática principal: `video_generations` com IDs, providência, source image (FK/URL), prompt local, status state e durabilidade associada (delineada do transient space). (Option B minimalista avaliada).

---

## IMPLEMENTATION SEQUENCE

### First REAL Vertical Slice
O menor eixo end-to-end não-esboço.
- **Backend Schema**: Migration isolada com a nova tabela perene de mídias transitórias de `video_generations`. Adaptação da `generation_tasks` para aturar callbacks de tipo vídeo.
- **Production UI**: Subverter o `Criar Vídeos` em Production para fazer push roteador ao `videos?project=x&production=x` Workspace da UI Generativa real, retirando formalmente o criador prévio do `createVideoDraftForCreativeEditor()`.
- **API Flow real**: Implementação do Adapter `lib/ai-simulator/video` para Luma ou Runway, um `POST /api/video-generation/generate` despachando Task real, e retorno via Polling/Webhook validado para descer um clipe visual provado de baixa constrição à UI de exibição local consumindo assets originais criados das imagens base (I2V prompt).

### Futuros Slices (Posteriores)
1. **Ponte Library Explícita**: Um botão e endpoint sob os vídeos prontos para submeter o clone para `library_files`. Retenção programada para limpar transientes não salvos.
2. **Refinamentos/Batch**: Múltiplos I2V encadeados. Input text-to-video (T2V option para free experimentation bypassando evaluator).
3. **Draft Workflow Bridge**: Injeção direta contextualizada de Video recém baixado para a base nova do Scene Timeline (Se requerido).

VIDEO_AI_GENERATION_PRODUCT_FLOW_DISCOVERY_V1_COMPLETE

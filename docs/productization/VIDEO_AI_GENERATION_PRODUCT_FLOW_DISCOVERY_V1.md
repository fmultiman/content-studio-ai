# Discovery: Video AI Generation Product Flow V1

## FACTUAL CURRENT STATE

### 1. Worktree & Git
- **Origem Factual**: Repositório canônico local (`D:\Trabalhos\Content Agent Studio\content-studio-ai-git`).
- **Branch**: `discovery/video-ai-generation-product-flow-v1`.
- **Starting SHA**: `40198f1bf4e5f5d5f5ba0ee25cdf4d3fcd2c3af0` (HEAD at branch creation).
- **Base SHA Aplicado**: `77320afc31c787ae3d7c6930ea35049b6038d430` (Project Identity Visual Tokens closure proof).
- **Estado do Creative Editor**: A worktree existente `traycer-witty-puma...` (`feat/creative-editor-video-foundation-v1`) foi mantida rigorosamente intocada.
- **Preservação da Modificação Estrangeira (VIDEO_AUDIO_AUTHORING_V1.md)**: A auditoria do histórico Git confirmou que a alteração descrita encontrava-se originalmente atrelada ao commit `a34ba61`, em vez do commit de closure `98b79c4`. Ela permaneceu na base intacta através da checkout do SHA `77320afc`. Em nenhuma etapa esta modificação foi manipulada, restaurada ou comitada novamente nesta frente.

### 2. Arquitetura Factual de `Production`
- A interface da Production possui atualmente os entry points "Criar Imagem" e "Criar Vídeo".
- **Comportamento Misto**:
  - `Criar Imagem`: Redireciona o usuário de forma coesa para o workspace estático em `/imagens?project=X&production=Y`. Nenhuma imagem nasce automaticamente.
  - `Criar Vídeo`: Executa a função local `createVideoDraftForCreativeEditor()`, enviando um `POST /api/video-drafts` para criar fisicamente um `VideoDraft` canônico e imediatamente navega o usuário para `/creative-editor/video/[draftId]`.

### 3. Arquitetura Factual de `/imagens`
- Tudo ocorre no workspace integrado em `app/(dashboard)/imagens/page.tsx`.
- Os "rascunhos" salvos e consultados estão guardados na tabela `image_drafts`.
- O registro permanente de imagens fica em uma tabela `images` isolada, com campos `status` (generating, approved, draft).
- **Durabilidade e Integração LibraryFile**: Quando uma geração no provedor é concluída, a mídia do resultado é registrada como uma URL pública num field da tabela `images`. A aprovação muda logicamente o `status` para `approved`. Ela **não** cria automaticamente uma entry de `LibraryFile`.

### 4. Arquitetura Factual de `generation_tasks`
- **Schema Existente**: `id`, `user_id`, `task_id`, `provider` (default nanobanana), `prompt`, `aspect_ratio`, `status`, e crucialmente: `image_url`.
- **Veredicto**: É **semanticamente image-specific**. A amarração rígida com `image_url` e `aspect_ratio` (sem metadados de mídia audiovisual) tornam a tabela inadequada para ser considerada polimórfica para vídeo sem forçar um malabarismo arquitetural de renomeação ou colchetes genéricos.

### 5. Arquitetura Factual de `/videos` (Draft Hub)
- A tela `app/(dashboard)/videos/page.tsx` encontra-se rebatida funcionalmente a atuar apenas como Hub Histórico de Visualização.
- O workspace obsoleto e o player de render foram eliminados (os estados `?draft=` contêm hard redirects via `proxy.ts`).
- Atualmente ela não executa ações de authoring autônomas e atua simplesmente como despachante de rascunhos para o Creative Editor. Esta mesma interface lista os artefatos produzidos historicamente na tabela genérica `video_drafts`.
- A rota está conceitualmente madura e sem legado perigoso para ser atualizada com a futura UI semântica de Geração.

### 6. Arquitetura Factual do Image Evaluator
- **Fluxo**: Integrado à tela de `/imagens`, ao solicitar avaliação, um `POST /api/evaluate-image` é submetido.
- **Payload**: O schema despacha a URL da imagem (`imageUrl`), o `generatedPrompt`, o `ProjectIdentity` normalizado e o contexto da produção.
- **Provider**: Aproveita modelos com capacidade de visão estática pura. O AI processa e responde com notas e refinos textuais (`refinedPrompt`). 
- Toda submissão é inserida em `generation_attempts` persistidas atreladas à entidade de `ImageDraft`.

---

## EXTERNAL PROVIDER FACTS
- A API documentada consumindo infraestrutura atual utiliza provedores como **NanoBanana** e **OpenAI**. 
- O fluxo externo com provedores assíncronos (ex.: NanoBanana) baseia-se num duplo controle: webhook (recebido pelo backend em `/api/nanobanana/callback` que altera as flags do DB) acoplado a um `polling` reativo de tempo curto (5 em 5 segundos) no Frontend, acompanhando a atualização de status para disparar a troca visual do result screen.

---

## PROPOSED FUTURE STATE

### Respostas aos Questionamentos do Escopo

1. **`/videos` deve assumir oficialmente geração de vídeo por IA?**
   - Sim. Para manter simetria arquitetural limpa com `/imagens`. A geração não é uma competência do Creative Editor.
2. **Production deve oferecer `Criar vídeo` equivalente semanticamente a `Criar imagem`?**
   - Sim. O fluxo no front do `Production` deve parar de criar os rascunhos às cegas no banco da mesma maneira que a feature de imagem se comporta.
3. **O botão atual de criação de VideoDraft em `/videos` deve desaparecer/mudar?**
   - Sim. O `Criar Novo Vídeo` será alterado para rotear o usuário a algo como `/videos/workspace`, seguindo as exatas intenções que o workspace contextual proporciona nas imagens, sem executar `POST /api/video-drafts`.
4. **Qual entidade representa uma geração de vídeo?**
   - Um novo tipo derivado: uma tabela `generated_videos` (ou `video_generations`) controlada. Nela, o ciclo de vida inicial gerencial do ativo independe totalmente de um authoring ou da Library principal.
5. **A `generation_tasks` existente serve?**
   - Não. Semanticamente específica para imagens (carrega `image_url` e carece de specs como duration e fps de saída).
6. **Precisamos evoluir schema e qual migration seria necessária?**
   - Sim. Uma migration que cria a tabela `generated_videos` (armazenando request prompt, status, video_url) e possivelmente `video_generation_tasks` acoplada.
7. **Resultado gerado deve virar LibraryFile automaticamente ou explicitamente?**
   - Explicitamente transiente, igual ao das imagens. O vídeo processado finaliza num storage e numa URL da entidade geradora, acompanhado de um workflow UX que exiba opções de "Salvar para a Library" (LibraryFile hard link) ou Descartar.
8. **Onde o arquivo gerado fica armazenado?**
   - Armazenado fisicamente no bucket `videos` em S3/Supabase (análogo ao `images`). O dado perene permanece se o usuário o classificar fisicamente, senão o lixo lógico o trata após certa janela.
9. **Como `/videos` mostra queued/running/completed/failed?**
   - Utilizando o mesmo polimorfismo visual (StatusBadges e States) das Imagens. O frontend executa `polling` de leitura nas linhas de tasks da nova tabela recém despachada.
10. **Como evitar GenerationTask → VideoDraft?**
    - Remover todas as lógicas que realizam requisições para `POST /api/video-drafts` durante ações de "Criar vídeos" externas. O draft só existe no instante em que um usuário declara entrar no Creative Editor para authoring.
11. **Como um resultado chega conceitualmente ao Creative Editor (A menor Bridge)?**
    - **Salvar na Mídia/Library (Asset Creation)**: O asset do vídeo é promovido a uma `LibraryFile` real, sendo indexado. Como o Creative Editor permite inserção e manuseio direto via abas da Biblioteca de Mídia para as *Free Scenes* e *B-Roll*, essa biblioteca já lê as Entidades de Arquivos aprovadas nativamente da CDN. Essa é a interseção exata (nenhum schema conectivo além da base de Storage/Arquivos é necessário).

### Decisões Cruciais do V1 (Generation Model & Lifecycle)

#### Text-to-Video, Image-to-Video ou Ambos?
O **Image-to-Video** é a escolha lógica, segura e arquiteturalmente superior para o *V1*.
- Produzir imagem primeiro preserva toda a inteligência construída e provada (Project Identity Tokens, Evaluator Feedback).
- Permite validação de marca e contexto e não dilapida tokens ou ciclos custosos da API de vídeo (onde T2V falha gravemente sobre direcionamentos sutis corporativos).
- Integra UX com uma sensação coesa: o fluxo de vídeo atua perfeitamente como upgrade lógico de uma geradora provada (`/imagens`).

#### Flow de Polling ou Webhook?
- **Modelo Combinado (Simetria Front/Back)**: Apesar do benefício universal do webhook puro, o V1 replicará a arquitetura estabelecida das tarefas de imagens (ex: NanoBanana). O Back-End submeterá a task de webhook para encerramento durável e registro (para não perder nada se a aba for fechada), mas a fluência de carregamento ao usuário decorrerá de leitura ativa (polling iterativo) mantendo controle total sobre a responsividade UI do workspace presente sem incorrer em sockets complexos de V1.

#### Descobertas: Video Evaluator Layer
- **A. Native Video Understanding**: Caros e com latências impeditivas e imprevisíveis.
- **B. Sampled-Frame Evaluation**: Exige arquitetura adicional (servidor ffmpeg nativo, extração por intervalo base, custos compostos por frames em request unificada no GPT4-o). 
- **Veredicto Final para o V1**: **Sem evaluator (Opção C)**.
A geração está alicerçada puramente num asset imagético de entrada que **já absorveu e superou a bateria rigorativa do Image Evaluator**. Avaliar o output do vídeo será desproporcional neste estágio. O clipe gerado final fornece ao usuário utilidade de pronto ou descarte de pronto (feedback analógico primário).

---

## 8. PLANO DE IMPLEMENTAÇÃO E SEQUÊNCIA DE SLICES (First Vertical Slice)

Para prosseguir para o `VIDEO_AI_GENERATION_V1` de forma incremental, evite reengenharias e limite o perímetro base:

### Parte 1: Ajuste de Fronteira e Schema Físico 
*O PRIMEIRO vertical slice executável*
- **Objetivo**: Estancar a criação imediata errônea de drafts de Creative Editor no "Criar Vídeos" de Produção, roteando a um esqueleto na rota `/videos`.
- **Schema**: Adicionar migration (Ex.: `039_create_generated_videos.sql` contendo `video_generations` e `video_generation_tasks`.) Sem providers nesta etapa, só DB e UI base.
- **UI Impact**: Retirar a função `createVideoDraftForCreativeEditor()` e criar o redirecionador.
- **Critério**: O usuário entrará num workspace dummy de `/videos` capaz de despachar payloads pro Back-end de forma estável e segura sem causar ruído com `video_drafts` existentes.

### Parte 2: O Componente Image-to-Video (I2V AI Provider Adapter)
- **Objetivo**: Efetuar interface (Adapter TSX) à nova tabela para registrar chamadas simuladas ou prontas para o provider inaugural com o fallback de Polling/Webhook já acoplado. Permite arrastar os inputs da Galeria das Imagens ou URL persistente na tela UI.
- **Critério**: Finalizar lifecycle completo. Uma submissão na tela UI que altera o estado local das filas (`queued -> processing -> complete/failed`), onde o asset fictício ou consumido recai no container UX principal sem transitar ainda pra LibraryFile.

### Parte 3: Operação de Ponte LibraryFile
- **Objetivo**: Submeter explicitamente um resultado válido em S3 da nova base para ingressar logicamente à autoridade definitiva da tabela `library_files`. (Opção de Ação UX: "Salvar Asset na Biblioteca" sob o vídeo). 
- **Critério**: É checado no Creative Editor nativo sob a secção Media/Archivos que o mesmo pode ser arrastado sem embaraços via timeline do Free-Composition.

VIDEO_AI_GENERATION_PRODUCT_FLOW_DISCOVERY_V1_COMPLETE

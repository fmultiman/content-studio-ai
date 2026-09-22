# Phase 2D0 — Creative Workspace Product Architecture

**Produto:** Content Agent Studio
**Escopo:** read-only architecture / product surface study
**Base factual:** HEAD `89a1888` — `feat: add project primitive authoring proof`
**Data da auditoria:** 2026-09-21
**Resultado:** `CREATIVE_WORKSPACE_SUPPORTED_WITH_REFRAMING`

> `FACT` = observado no repositório ou em uma migration existente.
> `INFERENCE` = conclusão derivada de fatos.
> `RECOMMENDATION` = direção proposta.
> `OPEN QUESTION` = lacuna que não deve ser tratada como decisão.

## 1. Executive Summary

**FACT.** O produto já tem um eixo de contexto persistido: `Project → Production →` drafts/conteúdo editorial. O domínio de publicação acrescenta `EditorialContent → ChannelPiece → ChannelPieceMedia`. `ChannelPiece` guarda `channel` e `format`; não existe tabela ou tipo `ContentVersion`.

**FACT.** O repositório já contém um core técnico de creative rendering: manifests estático e de timeline, schemas Zod, template registry em código, resolução de identidade/assets, componentes compartilhados e adapters Remotion. Phase 2C adicionou authoring state, seleção project-scoped de primitives e round-trip de render, ainda em `/dev/creative-preview`.

**FACT.** `Images` é hoje uma superfície de geração/evaluation de imagens. `ImageDraft` guarda prompt, tentativas, avaliação e referência à imagem atual; o resultado é uma linha `images` e/ou storage S3. Não há árvore de composição visual nessa área.

**FACT.** `Videos` é um storyboard/draft editor de cenas, com autosave em `video_drafts.scenes` e geração de prompt por cena. A ação “gerar vídeo” permanece simulada; não há render de produção conectado ao draft. A estrutura de cena já contém descrição, prompt, imagem, duração e movimento.

**INFERENCE.** A direção correta não é um “CreativeContent” paralelo. Creative Workspace deve ser uma capability/shell contextual que edita entidades existentes e usa um core de authoring/rendering comum. A hipótese precisa de reframing: não há evidência para um único editor visual universal nem para uma `Content Version` já existente.

**RECOMMENDATION.** Usar shells separados para static e timeline, compartilhando contratos, identity, assets, templates, primitives, preview e rendering core. O shell estático deve abrir um `ChannelPiece` (com `EditorialContent` e `Project` acima dele); o shell timeline deve continuar abrindo `VideoDraft`, podendo receber um target de `ChannelPiece` quando essa relação existir. A persistência de authoring deve acompanhar o host existente até que uma necessidade real de versionamento seja demonstrada.

## 2. Scope / Method

Foram inspecionados apenas os caminhos relevantes ao produto e à iniciativa:

- migrations `001`, `002`, `015`, `017`, `018`, `020`, `021`, `022`, `027` e `028`;
- tipos em `lib/types.ts`, canais em `lib/publication-channels.ts` e APIs de Projects, Productions, drafts, publicação, Library e storage;
- páginas `/projetos`, `/projetos/[id]`, `/projetos/[id]/producoes/[productionId]`, `/projetos/[id]/conteudos/[editorialContentId]`, `/conteudos`, `/imagens`, `/videos`, `/galeria`, `/arquivos`;
- `lib/creative/**`, `remotion/**`, scripts de render e `/dev/creative-preview` adicionados até Phase 2C;
- `docs/discovery/creative-rendering/**`, `docs/productization/creative-rendering/PHASE_2C_PRIMITIVE_DISCOVERY_AUTHORING.md` e decisões de publicação como contexto de intenção, sem tratá-las como substitutas do código.

Não foram executados migrations, queries de produção, uploads, renders, instalações ou alterações de source. A única escrita desta missão é este documento.

## 3. Current Product Model — factual map

| Área | Persistência / símbolo real | Superfície real | O que significa hoje |
|---|---|---|---|
| Project | `projects`, `Project` (`lib/types.ts`) | `/projetos`, `/projetos/[id]` | identidade, contexto, avaliação e dono dos recursos |
| Project Identity | `projects.identity` JSONB; `ProjectIdentitySchema` | formulário/display de identidade do Project | schema V1 normalizado; texto/arrays, não tokens visuais estruturados |
| Production | `productions`, `Production` | detalhe dentro de Project | agrupador obrigatório para criação corrente de drafts |
| Image generation | `images`, `image_drafts`, `Image`, `ImageDraft` | `/imagens`, `/imagens/rascunhos` | prompt → provider → imagem/evaluation → draft |
| Video authoring | `video_drafts.scenes`, `VideoDraft`, `VideoScene` | `/videos`, `/videos/rascunhos` | storyboard editável e autosave; render final ainda simulado |
| Editorial content | `editorial_contents`, `EditorialContent` | `/conteudos`, detalhe por Project | texto editorial e contexto de IA, status draft/ready/archived |
| Channel variant | `channel_pieces`, `ChannelPiece` | detalhe de EditorialContent | adaptação por canal/formato, status draft/ready/approved/archived |
| Output media | `channel_piece_media`, `ChannelPieceMedia` | media picker/section | imagem ou LibraryFile por papel/posição; não é versão nem artifact genérico |
| Library | `library_files`, `library_folders`, `LibraryFile` | `/arquivos` | upload, pastas project-scoped, S3 path, MIME, lixeira e download |
| Generated gallery | `images` e leitura de outputs | `/galeria` | galeria de imagens geradas, não um registro de render execution |
| Rendering proof | manifests, resolver, Remotion adapter | `/dev/creative-preview`, scripts | capability técnica/dev-only, não fluxo de produto |

Não foram encontrados `ContentVersion`, `ProductionArtifact`, `Approval` como entidade, `History`, `RenderExecution`, `ScenePlan` ou tabela de output renderizado. Aprovação existe apenas como status (`images.status`, `channel_pieces.status`); não há histórico de decisões.

## 4. Project / Production / Content / Version relationship

**FACT.** `Production.project_id` é obrigatório. `EditorialContent.project_id` é obrigatório e `production_id` é opcional. `ImageDraft` e `VideoDraft` têm `project_id` e `production_id`, ambos nullable no schema histórico, embora as APIs atuais exijam Production ao criar. `ChannelPiece` não aponta diretamente para Project ou Production; chega neles por `editorial_content_id`.

**FACT.** `EditorialContent` é o texto editorial central. `ChannelPiece` é a variante channel-specific; as decisões documentadas de publicação explicitam que `channel` e `format` pertencem ao ChannelPiece, não ao EditorialContent.

**FACT.** Não existe `ContentVersion`. `updated_at` é timestamp de registro, não versão imutável. Não há `version_number`, parent/version relation, snapshot ou diff.

**Resposta à pergunta “o que é Content hoje?”** É `EditorialContent`: um registro textual, project-scoped, opcionalmente ligado a Production, com status editorial. Não é ainda o documento visual nem o item versionado aberto por um editor gráfico.

**Resposta à pergunta “o que pertence a uma Content Version?”** Nada factual: essa entidade não existe. Não se deve afirmar que layout, template ou render output já pertençam a uma versão.

**Unidade atual de authoring:**

- **Static:** `ChannelPiece` é o melhor contexto existente para uma peça por canal/formato; `EditorialContent` fornece texto e `Project`/`Production` fornecem contexto.
- **Timeline:** `VideoDraft` é a unidade real de authoring de cenas. Ela pode ser contextualizada por Project/Production e futuramente ligada a uma variante de publicação, mas essa ligação não existe no schema atual.

**Decisão de enquadramento:** a opção A (“editar diretamente uma Content Version”) não é aplicável hoje; a opção B também não tem objeto filho existente. A opção C — sessão transient que produz/atualiza o host existente e eventualmente gera media — é a única compatível sem inventar entidade. Para static, a sessão pode editar uma `ChannelPiece`; para timeline, um `VideoDraft`.

## 5. Existing Content Types / Targets

**FACT.** `PublicationChannel` é `instagram | youtube | whatsapp | linkedin | x | tiktok`. `PublicationFormat` é `feed | story | reel | short | video_description | post | channel_message | carousel | article`. A combinação é validada por `isValidChannelFormat()` em `lib/publication-channels.ts` e por CHECKs em `scripts/021_create_publication_entities.sql`.

Exemplos reais:

| Conceito do produto | Modelagem factual |
|---|---|
| Instagram Reel | `channel = instagram`, `format = reel` |
| YouTube video-like target | `channel = youtube`, `format = short` ou `video_description`; não há `youtube_video` dedicado |
| Instagram Post | `instagram:feed` ou `instagram:carousel`, conforme intenção |
| Carousel | `format = carousel`; não é uma entidade separada |
| Static social piece | combinação `channel × format` + mídia opcional |

**FACT.** Os tipos não armazenam canvas, aspect ratio, duração, codec, template ou modo static/timeline. `TemplateDescriptor` já declara `supported_modes`, canvas sizes e motion presets no registry criativo, mas não está ligado automaticamente a `ChannelPiece`.

**RECOMMENDATION.** Um futuro target adapter deve ler `ChannelPiece.channel/format` e consultar uma capability registry para derivar canvas, mode, duração e exportação. Não criar campos paralelos no Workspace. As regras que não existem hoje — por exemplo duração de Reel ou exportação específica de YouTube — são lacunas, não fatos.

## 6. Images — factual role

**FACT.** `/imagens` mantém estado de prompt, modelo, project/production selection, evaluator e histórico de tentativas. `POST /api/image-drafts` persiste um `image_drafts`; providers `/api/openai/generate-image` e `/api/nanobanana/generate` produzem imagem/tarefa. OpenAI pode fazer upload do binário para S3 via `uploadImageToS3`; o draft referencia a imagem atual (`current_image_id`) quando disponível.

**FACT.** A área de Images não possui component tree, template slots, posicionamento, camadas, primitive picker ou timeline. O preview é do resultado gerado, não de uma composição determinística.

**Conclusão:** Images deve permanecer principalmente **AI asset-generation capability**. Isso não é uma duplicação do Creative Workspace.

**Boundary recomendado:**

`Images generator → images/S3 output → Image ou LibraryFile/ChannelPieceMedia → Creative Workspace`

Hoje já existe suporte a `image_id` em `ChannelPieceMedia` e a `library_file_id` para arquivos da Library. A escolha entre ambos deve respeitar a origem real; não introduzir outra tabela de assets por conveniência.

## 7. Videos — factual role

**FACT.** `/videos` edita um array de `VideoScene` com `id`, `order`, `description`, `prompt`, `image_url`, `duration` e `movement`. Há add/update/delete/reorder, prompt por cena, storyboard modal e autosave para `video_drafts` quando Project e Production estão definidos.

**FACT.** `POST/PATCH /api/video-drafts` grava `name`, `project_id`, `production_id` e `scenes` como JSONB sem um schema Zod de cena no boundary. `handleGenerateVideo` espera três segundos e mostra “fluxo simulado”; não existe output MP4 ligado ao draft.

**Classificação:** combinação de draft manager + storyboard/authoring de vídeo + prompt generator; ainda não é um renderer/editor de timeline de produção.

**Específico de vídeo:** cena, ordem, duração, movimento, sequência e storyboard.
**Authoring genérico reaproveitável:** seleção de assets, conteúdo textual, identidade, template, preview, estado de edição e render input.
**INFERENCE:** `VideoDraft.scenes` é o embrião factual do timeline mode; não deve ser substituído prematuramente por outra abstração.

**Um clip rápido:** sim, a mesma estrutura pode representar uma única scene. O próprio UI aceita `scenes.length === 1`, calcula `totalDuration` e mostra storyboard; não há necessidade arquitetural de um editor paralelo “single clip”. Um vídeo longo é o mesmo modelo com mais scenes/tracks e maior complexidade de timing.

**RECOMMENDATION.** Evoluir o Videos atual por um adapter `VideoDraft → TimelineManifest` quando o render de produto for priorizado. Preservar `VideoDraft` como fonte de authoring até haver decisão explícita de versionamento/normalização.

## 8. Library / Assets relationship

**FACT.** `LibraryFile` possui `project_id`, `kind`, MIME, tamanho, `storage_path`, `public_url`, thumbnail e `deleted_at`; `LibraryFolder` é project-scoped. `/arquivos` usa presigned upload (`/api/storage/presign-image-upload`), grava metadata em `/api/library-files` e oferece mover, restaurar, lixeira e download.

**FACT.** S3 é provider de storage com `createPresignedReadUrl`; URLs assinadas são resolvidas em tempo de leitura. `ChannelPieceMedia` aceita exatamente um `image_id` ou `library_file_id`, com papéis `primary`, `thumbnail`, `carousel_item`, `background` e `attachment`.

**Reuse assessment:**

`upload → LibraryFile → AssetRef/resolve → template slot → renderer` é compatível com a infraestrutura real, mas `AssetRef` e o resolver neutro são novos contratos criativos. Não duplicar upload, S3, folders ou media picker.

**Lacunas factuais:** LibraryFile não guarda width/height/checksum/alpha/semantic role; SVG sanitization e primitive catalog de produto não estão implementados. Isso não justifica criar uma Library paralela nesta fase.

## 9. Current Shared Creative Rendering capabilities

**FACT.** O core vive em `lib/schemas/creative`, `lib/creative`, `components/creative` e `remotion`:

- `StaticRenderManifest` e `TimelineManifest` são contratos Zod neutros;
- `lib/creative/resolution/*` resolve identity, templates e assets;
- `lib/creative/templates/registry.ts` é registry estático em código com Documentary Card e Quote Card, ambos declarados para `still` e `video`;
- `lib/creative/integration/*` adapta Project Identity e LibraryFile;
- `remotion/DocumentaryCardComposition.tsx` e `remotion/timeline/TimelineComposition.tsx` são adapters/árvores de render;
- `app/dev/creative-preview/render/route.ts` chama o render bridge local-dev-only;
- `scripts/creative/render-authoring-request.ts` resolve primitives selecionadas para S3 durante o round-trip.

**FACT.** O browser preview e o final render compartilham a árvore `DocumentaryCard`, mas Phase 2C ainda usa proxy fixture no browser para primitives. `primitiveTransforms` existem no state/UI e não são ainda reproduzidos no PNG final.

**FACT.** Remotion já está em `package.json` (`remotion`, `@remotion/bundler`, `@remotion/player`, `@remotion/renderer`, CLI), todos na versão `4.0.526`. O relatório anterior que dizia “Remotion não encontrado” está obsoleto para este HEAD.

## 10. Phase 2C Authoring Lab audit

| Parte de `/dev/creative-preview` / Phase 2C | Classificação | Evidência / destino |
|---|---|---|
| `AuthoringState` e reducer | **PROMOTE TO PRODUCT**, adaptando o host | `lib/creative/authoring/authoring-state.ts`; estado neutro útil, mas identity/project ainda é fixture |
| `primitiveSelection` semantic keys | **PROMOTE TO PRODUCT** | seleção deve permanecer ao lado do manifest, sem signed URL |
| `primitiveTransforms` | **REUSE + ADAPT** | promover ao render input antes de chamar de produto; hoje é authoring-only |
| sliders/pickers | **ADAPT** | controls são prova de interação; UI precisa de contexto real e capabilities de target |
| preview com `DocumentaryCard` | **PROMOTE TO PRODUCT** | mesma árvore é direção correta; trocar proxy por resolver de contexto quando possível |
| render round-trip | **PROMOTE TO PRODUCT** | mecanismo compartilhado, mas endpoint atual é dev/local-only |
| debug panel | **DEV-ONLY** | útil para diagnóstico, não superfície de usuário |
| fixture identity selector | **DEV-ONLY → DEPRECATE LATER** | substituir por Project real; não transportar para produto |
| fixture asset/primitive preview | **DEV-ONLY → ADAPT** | Library/primitive refs reais devem alimentar preview; sem expor signed URLs persistentes |
| `render endpoint` | **ADAPT** | manter bridge técnico isolado; produção exige autorização e runtime de render apropriado |

## 11. Static vs Timeline architecture comparison

| Dimensão | Static | Timeline | Shared core |
|---|---|---|---|
| Domain host atual | `ChannelPiece` + EditorialContent | `VideoDraft` | Project/Production/Identity |
| Contrato | `StaticRenderManifest` | `TimelineManifest` | validation, `AssetRef`, `TemplateRef` |
| Component tree | Still/shared component | mesma template em `TemplateSegment` | template registry + component resolver |
| Assets | hero, paper, tape, evidence, media | segment assets + motion | Library/asset resolver |
| Identity | snapshot por composição | snapshot por timeline | Project Identity adapter |
| Authoring controls | canvas, content, slots, transforms | scenes, order, duration, movement | reducers/state boundaries |
| Timing | ausente | frames/duration/motion | template motion capability |
| Output | PNG/estático | frame/MP4 futuro | renderer adapter |
| Lacuna de produto | output/version relation | render/output relation | persistence formal |

**Conclusão:** static e timeline não são o mesmo estado de domínio. Um único shell tentaria fundir canvas controls e scene/timing controls sem apoio na UI existente. A opção factual mais segura é **Option 3: shells separados, authoring/rendering core compartilhado**. Os templates podem ser polimórficos quando declararem suporte, como já ocorre no registry.

## 12. Creative Workspace hypothesis assessment

**Supported part:** existe um core compartilhável real e há valor em uma capability de composição contextual.

**Reframing required:** “Workspace” não deve ser entidade persistida nem substituir Images/Videos/Editorial domain. Deve ser uma superfície de edição que escolhe o host existente:

```text
Project → Production → EditorialContent → ChannelPiece → Static Workspace
Project → Production → VideoDraft → Timeline Workspace
```

`ChannelPiece` informa target; `VideoDraft` informa sequência. Ambos consomem Project Identity, Library, templates, primitives, preview e render contracts.

## 13. Entity vs Capability decision

**Decisão: capability/surface, não nova entidade.**

**FACT.** Nenhuma necessidade exclusiva de uma entidade `CreativeWorkspace` foi encontrada. O trabalho já tem hosts persistidos e relações de ownership. Criar entidade paralela duplicaria Project/Production/Content e deixaria o output sem relação canônica.

**Authoring session:** pode existir transient em memória/URL durante a edição. Deve apontar para `project_id` + host (`channel_piece_id` ou `video_draft_id`) e carregar manifest/overrides temporários. Não deve ser persistida como nova tabela sem requisito de recuperação, colaboração ou histórico que o domínio atual não possui.

**OPEN QUESTION:** se usuários precisarem de autosave de layout independente de `ChannelPiece`/`VideoDraft`, será necessário decidir entre adicionar campos versionáveis ao host ou criar um objeto de revisão. Essa necessidade não está provada no código atual.

## 14. Persistence ownership map

| Informação | Dono factual atual | Tratamento recomendado |
|---|---|---|
| Project identity/context | `projects.identity`, `projects.context` | consumir; não duplicar no Workspace |
| channel/format target | `ChannelPiece.channel/format` | derivar mode/canvas por adapter |
| editorial text | `EditorialContent` / `ChannelPiece.body` | editar no host apropriado |
| selected template/variant | nenhum campo persistido | transient inicialmente; persistir no host somente quando decisão de produto existir |
| asset/primitive selection | `ChannelPieceMedia` para output/media; LibraryFile para asset | usar refs sem signed URLs; selection de composição ainda é lacuna |
| primitive transforms/layout | nenhum domínio atual | authoring state; promover ao render input; persistência é lacuna |
| scene/timeline state | `VideoDraft.scenes` | continuar no VideoDraft até adapter/normalização |
| render configuration | nenhum registro | request/manifest transitório inicialmente |
| render execution | nenhum registro | não inventar `RenderExecution` nesta fase |
| approved output | `ChannelPiece.status` aprova conteúdo, não arquivo | estático pode apontar output `LibraryFile` via `ChannelPieceMedia`; aprovação formal de artifact é lacuna |

Separação obrigatória: **domain state** (`Project`, `Production`, `EditorialContent`, `ChannelPiece`, `VideoDraft`) → **authoring state** (transient controls) → **render input** (manifest + resolved snapshot/refs) → **render execution** (processo Remotion) → **output/artifact** (hoje apenas media/library aproximada). Não promover o último estágio a nova entidade sem evidência.

## 15. Versioning implications

**FACT.** Nenhum registro immutable/versioned existe. Editar um `ChannelPiece` atualiza o registro; salvar um `VideoDraft` sobrescreve `scenes`. Um novo render não cria versão hoje.

**RECOMMENDATION, bounded:** no primeiro produto, edição de conteúdo/layout atualiza o host existente e render é consequência/reprova visual. Não afirmar que cada render deve criar Content Version.

**Lacunas a resolver antes de versioning:**

1. se uma revisão de layout deve ser recuperável sem alterar o texto;
2. se output aprovado precisa ser imutável e auditável;
3. se `latest_render` e `approved_output` são estados distintos;
4. se vídeo e static precisam da mesma unidade de revisão.

Essas são `OPEN QUESTION`, não motivo para criar `ContentVersion` agora.

## 16. Context / Entry Points

**FACT.** A navegação global atual é `Workspace: Dashboard, Projetos, Conteúdos`; `Criação: Imagens, Vídeos`; `Bibliotecas: Galeria, Arquivos` (`lib/sidebar-navigation.ts`). A Production detail já oferece abas Overview, Imagens, Vídeos e Conteúdos Editoriais.

**Natural entry point (if approved):**

- static: `Project → Production → Conteúdos → EditorialContent → ChannelPiece → Edit/Create Visual`;
- timeline: `Project → Production → Vídeos → VideoDraft → Edit timeline`;
- global create: escolher Project e Production primeiro; depois escolher/crear o host.

Uma capability pode ser globalmente descoberta, mas uma composição real não deve ser órfã: identity, primitive catalog, Library e target dependem de Project; Production organiza o trabalho; ChannelPiece ou VideoDraft fornece o item editado.

`/dev/creative-preview` não é entry point de produto: usa fixture identity/project selector e não carrega Content/Version real.

## 17. Generators → Library → Compositor boundary

**Conclusão:** a fronteira é compatível com o produto real, com uma nuance: outputs de Images hoje nascem na tabela `images`, enquanto uploads gerais nascem em `library_files`. `ChannelPieceMedia` já suporta os dois.

```text
Images / future AI video generators
        ↓
Image ou LibraryFile + storage metadata
        ↓
ChannelPieceMedia / VideoDraft asset references
        ↓
Creative Workspace authoring
        ↓
StaticRenderManifest ou TimelineManifest
        ↓
renderer adapter → output
```

Images não deve absorver composição. Videos pode fornecer assets/prompts e cenas, mas seu render timeline deve reutilizar o core, não transformar Remotion em domínio.

## 18. Existing UI / Route reuse map

| Necessidade futura | Reuso recomendado |
|---|---|
| Project/Identity context | `/projetos/[id]`, `project-identity-*`, `normalizeProjectIdentity` |
| Production context | `/projetos/[id]/producoes/[productionId]`, `ProductionForm`, APIs de Production |
| Editorial target | `/projetos/[id]/conteudos/[editorialContentId]`, `ChannelPieceMediaSection`, `MediaPickerDialog` |
| Static authoring shell | novo shell contextual sob route de conteúdo; reutilizar `lib/creative/authoring` e componentes creative |
| Timeline shell | evolução de `/videos`/`VideoDraft`, não nova rota top-level imediata |
| Assets/Library | `/arquivos`, `/api/library-files`, `/api/storage/*` |
| Gallery outputs | `/galeria` como superfície de revisão de imagens, não source of truth de render |
| Existing navigation | manter grupos atuais; adicionar ação contextual antes de adicionar item global |

## 19. Migration path from current product

Menor sequência coerente, sem big bang:

1. **Preservar o core Phase 2C.** Fechar round-trip de transforms (`2D-A`) como correção técnica de render input.
2. **Introduzir contexto real estático.** Selecionar um `Project → Production → EditorialContent → ChannelPiece` existente e adaptar o authoring state para esse host; sem nova tabela.
3. **Promover static shell.** Reusar `DocumentaryCard`, registry, identity adapter, Library refs e render bridge; remover fixture selector do fluxo de usuário.
4. **Definir output mínimo.** Para static, renderizar e registrar/associar o arquivo usando Library/`ChannelPieceMedia` quando a decisão de output for aprovada; não criar artifact genérico por antecipação.
5. **Adaptar timeline.** Criar import/bridge de `VideoDraft.scenes → TimelineManifest`, mantendo VideoDraft como authoring source e uma única scene válida para clip rápido.
6. **Só depois mapear target capabilities.** `channel × format` → mode/canvas/duration/export através de registry, sem duplicar campos em Workspace.
7. **Reavaliar versionamento.** Apenas se autosave, revisão e aprovação demonstrarem necessidade de snapshots imutáveis.

## 20. Assessment of Phase 2D-A/B/C

| Slice | Disposição | Justificativa |
|---|---|---|
| 2D-A Transform Round-Trip | **KEEP NOW** | corrige a fidelidade do core; independe do shell e evita promover UI divergente do PNG |
| 2D-B Real Project Loading | **REORDER / ABSORB INTO WORKSPACE MIGRATION** | substituir fixture identity por Project é necessário, mas deve carregar o contexto Project/Production/host real, não apenas trocar um selector por query |
| 2D-C Browser Preview with Real Assets | **DEFER / ABSORB** | preview com S3 real é útil, mas deve entrar quando o shell tiver Library/host autorizados; a solução atual de proxy fixture é uma constraint conhecida |

Não rejeitar 2D-A por causa do shell futuro; rejeitar a execução de B/C como melhorias isoladas de `/dev/creative-preview` antes de definir o contexto de produto.

## 21. Risks / contradictions

- **No Content Version:** não prometer histórico de layout ou render por versão.
- **Output gap:** `ChannelPieceMedia` é a melhor relação existente, mas não modela render provenance, latest/approved ou vídeo final.
- **Target gap:** `channel/format` não carregam aspect ratio, duração ou codec; um adapter novo será necessário.
- **Identity gap:** Project Identity V1 é texto/arrays; não há `VisualTokensSnapshot` persistido, FontRef por Project ou paleta estruturada.
- **Video gap:** `scenes` JSONB não tem validação de schema no API e geração final é simulada.
- **Asset gap:** LibraryFile não guarda dimensões/checksum/alpha; primitives ainda têm catálogo/lookup de prova e mapeamento de storage específico da Phase 2C.
- **Runtime risk:** Remotion renderer/bundler está no repo, mas render server-side não deve ser presumido como uma request normal da Vercel; o bridge atual declara `local-dev-only`.
- **Navigation risk:** criar uma top-level “Creative Workspace” agora duplicaria `/imagens`, `/videos` e `/conteudos`.
- **Orphan risk:** rotas globais e dados históricos permitem `project_id`/`production_id` nulos; qualquer editor de produto deve exigir contexto antes de compor.

## 22. Open questions

1. O output estático aprovado deve ser um `LibraryFile` ligado por `ChannelPieceMedia` ou uma nova relação de artifact?
2. Vídeo final precisa de uma relação com `VideoDraft`, `ChannelPiece` ou ambos?
3. Layout/selected template deve ser sobrescrito no host atual ou ter snapshot/revision separado?
4. Quais combinações `channel × format` são static versus timeline e quais constraints de duração/exportação valem?
5. `Project Identity` ganhará zonas estruturadas de typography/colors/brand ou continuará sendo compilada de prosa?
6. O catálogo de primitives permanece project-scoped; quando e como assets system/shared serão autorizados?
7. Qual runtime de render assíncrono será usado fora do bridge local?

## 23. Recommended next slice

**Próximo slice recomendado: `2D-A KEEP NOW`, seguido de um “contextual static authoring proof”.**

O slice deve provar, sem criar entidade ou migration, que um `ChannelPiece` real de uma Production real pode abrir o mesmo authoring/render core, consumir Project Identity e Library/primitive refs, manter o manifest neutro e produzir uma saída que possa ser associada à media surface existente. Só depois deve-se transformar o `VideoDraft → TimelineManifest` em produto.

## 24. Architecture Verdict

### `CREATIVE_WORKSPACE_SUPPORTED_WITH_REFRAMING`

**A hipótese de Shared Creative Workspace é coerente com a arquitetura real, mas não na forma de uma nova entidade nem de um único editor universal.**

O repositório suporta um **shared creative core** comprovado: identity adapter, templates, assets, primitives, static/timeline manifests, preview tree e Remotion adapter. O domínio, porém, é plural: static composition deve se contextualizar em `ChannelPiece`; timeline composition deve continuar ancorada em `VideoDraft`; `EditorialContent` é conteúdo editorial, não versão visual; Production e Project fornecem o contexto e ownership.

Respostas explícitas:

1. **Entity ou capability?** Capability/surface + transient authoring session; não nova entidade.
2. **Um shell?** Não. Shells static/timeline separados com core compartilhado (Option 3).
3. **Images?** Sim, permanecer generator-oriented; seus outputs alimentam Image/Library/ChannelPieceMedia.
4. **Videos?** Evoluir como embrião do timeline mode via adapter, preservando VideoDraft.
5. **Content Version?** Não existe; usar ChannelPiece/VideoDraft como hosts atuais.
6. **Channel/target?** Ler `ChannelPiece.channel/format`; derivar capabilities sem duplicar modelagem.
7. **Authoring state?** Inicialmente transient/host-local; `VideoDraft.scenes` continua domain authoring existente.
8. **Output/render?** Render é consequência; static pode usar LibraryFile + ChannelPieceMedia, enquanto vídeo/output formal é lacuna.
9. **Library assets?** Via LibraryFile/Image refs e resolver; não duplicar storage/upload.
10. **Phase 2C productization?** Promover state, preview tree e round-trip; manter debug/fixtures dev-only; adaptar transforms e contexto.
11. **Menor próximo passo?** 2D-A, então static authoring contextualizado em um ChannelPiece real.

<TRAYCER_NEXT_STEPS>
- [] Executar 2D-A: promover `primitiveTransforms` ao render input e provar paridade final.
- [] Projetar o slice de static authoring contextualizado em `Production → EditorialContent → ChannelPiece`, sem criar entidade nova.
</TRAYCER_NEXT_STEPS>

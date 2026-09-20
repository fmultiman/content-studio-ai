# Remotion Adapter Mapping V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** mapear contratos neutros do Studio para primitives atuais do Remotion


---


## 1. Objetivo


Definir a fronteira entre a Creative Rendering Layer e Remotion.


O adapter recebe contratos neutros e produz uma representação executável.


Nunca:


~~~
Remotion API
→ domínio
~~~


Sempre:


~~~
domain / manifest
→ resolved render input
→ Remotion Adapter
→ Remotion runtime
→ output
~~~


## 2. Inputs do adapter


Static:


~~~
StaticRenderManifest
ResolvedTemplate
VisualTokensSnapshot
ResolvedAssets
~~~


Video:


~~~
TimelineManifest
ResolvedTemplate Registry
VisualTokensSnapshot
ResolvedAssets
~~~


O adapter não consulta banco diretamente.


## 3. Output do adapter


Preview:


- React component tree;
- Player;
- Thumbnail;
- diagnostics.


Render:


- image;
- video;
- RenderExecution metadata.


O output aprovado continua seguindo o fluxo de artifacts/library do Studio.


## 4. Manifest versus inputProps


O manifest não deve ser passado cru ao template.


Fluxo:


~~~
manifest
→ validate
→ resolve template
→ resolve identity tokens
→ resolve assets
→ build renderer props
→ inputProps
~~~


Exemplo conceitual:


~~~
RendererProps
  content
  assets
  tokens
  canvas
  mode
  motion
~~~


## 5. Front-end authoring mapping


O Content Studio possui estado próprio.


~~~
Editor State
   ↓
serialize/normalize
   ↓
manifest
   ↓
resolve
   ↓
Player inputProps
   ↓
live preview
~~~


Alterar título no front-end deve atualizar props e preview.


Trocar hero asset deve atualizar props e preview.


Alterar Project Identity pode recompilar tokens e atualizar preview.


O JSON não é a superfície de edição.


## 6. Player


Uso recomendado:


- embedar preview dentro do Content Studio;
- enviar props resolvidos;
- controlar play/pause/scrub externamente;
- atualizar conteúdo em runtime;
- adicionar interações de canvas quando necessário.


O Player não vira fonte de verdade.


Estado persistente continua no Content Studio.


## 7. Direct manipulation


Interações podem usar pointer events e estado React.


Possíveis recursos:


- selecionar layer;
- drag;
- resize;
- focal point;
- crop interaction.


Regra:


~~~
canvas interaction
→ authoring action
→ editor state
→ manifest update
→ preview update
~~~


Nunca persistir diretamente coordenadas de UI temporárias no manifest sem passar pelo contrato do template.


## 8. Static mapping


Fluxo:


~~~
StaticRenderManifest
→ resolveTemplate()
→ ResolvedStaticRenderInput
→ Remotion Still component
→ preview Thumbnail
→ renderStill()
→ PNG/JPEG/WebP
~~~


O adapter pode possuir uma composition técnica interna para still.


Essa id não entra no manifest.


## 9. Video mapping


Fluxo:


~~~
TimelineManifest
→ validateTimelineSemantics()
→ resolve segments
→ Root Composition
→ tracks/layers
→ Sequence
→ components
→ renderMedia()
~~~


Width, height, fps e duration vêm de:


~~~
TimelineManifest.specification
~~~


Não de constantes hardcoded.


## 10. Track mapping


Direção inicial:


~~~
video track
→ visual sequences


overlay track
→ text/template sequences


audio track
→ audio sequences


caption track
→ caption sequences
~~~


A implementação pode usar z-index e ordem de tracks.


O domínio não precisa conhecer DOM order.


## 11. Segment mapping


Cada segment temporal vira um intervalo.


Conceitualmente:


~~~
start_frame
→ Sequence.from


duration_frames
→ Sequence.durationInFrames
~~~


O componente dentro da Sequence depende do kind.


## 12. Template segment


~~~
Timeline TemplateSegment
→ TemplateRef
→ Registry
→ React Template Component
→ RendererProps
→ Sequence
~~~


O mesmo componente utilizado por still pode ser reutilizado em vídeo.


## 13. Layer mapping


Para templates full-canvas, uma primitive equivalente a AbsoluteFill pode organizar layers.


Exemplo:


~~~
AbsoluteFill
├── Hero
├── Overlay
├── Text
└── Brand
~~~


Essa escolha permanece interna ao template/adapter.


## 14. Motion mapping


MotionSpec é semântico.


~~~
slow_push
fade
rise
reveal
~~~


O adapter/template traduz para funções frame-based.


Exemplo conceitual:


~~~
frame
→ progress
→ interpolate()
→ transform / opacity
~~~


Motion com sensação física pode usar spring().


Nenhuma dessas APIs aparece no manifest.


## 15. slow_push V0


Input:


~~~
preset: slow_push
intensity: 0.35
~~~


Implementação conceitual:


~~~
base scale = 1.0
target scale = template-defined
progress = frame / duration
scale = interpolation
origin = focal point
~~~


A amplitude concreta pertence à versão do template.


Exemplo:


~~~
template 0.1.0
slow_push intensity 0.35
→ target scale aproximadamente 1.05-1.08
~~~


Isso deve ser calibrado no spike.


## 16. Still mode


Still deve renderizar o estado final visual do template.


Motion:


- ignorado;
- ou resolvido em frame canônico definido pelo template.


Direção V0:


~~~
motion ignored for still
~~~


Assim o still não depende de tempo artificial.


## 17. Font resolution


A Project Identity não deve carregar lógica Remotion.


Pipeline:


~~~
FontRef
→ Font Catalog / Font Resolver
→ renderer font loader
→ ready
→ template render
~~~


Providers iniciais possíveis:


- google_fonts;
- local;
- project_upload.


## 18. Google Fonts provider


A camada global de fonts pode consultar catálogo e metadata.


Exemplo conceitual:


~~~
FontCatalogProvider
  search()
  getFamily()
  listVariants()
  listSubsets()
  resolveFontRef()
~~~


O renderer recebe um FontRef resolvido.


Para Remotion, google fonts podem ser carregadas pelo pacote próprio.


## 19. Local fonts


Para reprodutibilidade e fontes privadas:


~~~
FontRef
→ asset/storage
→ local font resolver
→ renderer
~~~


O adapter pode usar mecanismo de fonte local do Remotion.


Não distribuir automaticamente fonte enviada por cliente sem tratar direitos/licença.


## 20. Font loading gate


Render não deve iniciar antes da fonte necessária estar pronta.


Erro possível:


~~~
font_resolution_failed
font_variant_missing
font_load_timeout
~~~


Preview pode mostrar fallback somente se isso estiver explicitamente marcado como warning.


Final render não deve silenciosamente trocar a fonte.


## 21. Asset resolution


AssetRef permanece neutro.


~~~
AssetRef
→ AssetResolver
→ ResolvedAsset
→ renderer URL/path
~~~


ResolvedAsset pode conter:


- URL temporária;
- local path;
- mime type;
- dimensions;
- duration;
- checksum.


Não persistir URL temporária como fonte de verdade.


## 22. Focal point mapping


Input:


~~~
focal_point.x
focal_point.y
~~~


Still:


- orienta object position/crop.


Video:


- orienta transform origin;
- slow_push permanece centrado no ponto relevante.


## 23. Preview parity


Regra central:


> Preview e final render devem usar a mesma árvore visual sempre que possível.


Não criar:


~~~
fake CSS preview
+
different Remotion final render
~~~


Preferir:


~~~
same resolved template
├── Player/Thumbnail
└── renderer
~~~


## 24. Diagnostics


Adapter deve produzir warnings e errors estruturados.


Exemplos:


~~~
asset_not_resolved
font_not_loaded
template_not_found
unsupported_canvas
unsupported_motion
content_overflow_risk
media_decode_failed
render_failed
~~~


Esses erros não devem ser transformados em strings soltas de UI.


## 25. RenderExecution boundary


Manifest é intenção.


Execution registra tentativa.


Exemplo:


~~~
execution_id
renderer: remotion
renderer_version
status
started_at
completed_at
input_manifest_ref
output_ref
warnings
technical_metadata
~~~


Falha de Remotion não altera o manifest.


## 26. Rendering V0


Primeiro spike local/server:


Static:


~~~
renderStill()
~~~


Video:


~~~
renderMedia()
~~~


Decisão sobre Lambda, Cloud Run, Vercel Sandbox ou worker próprio fica fora do primeiro spike.


## 27. Editor Starter e Timeline do Remotion


Remotion possui recursos próprios voltados a construção de editores.


No V0 eles devem ser tratados como:


~~~
reference / possible accelerator
~~~


e não como dependência arquitetural.


Motivos:


- Content Studio já possui domínio próprio;
- queremos controlar Authoring State;
- licenciamento e produto precisam ser avaliados;
- não queremos herdar um editor externo como fonte de verdade.


## 28. Studio versus Product UI


Remotion Studio serve desenvolvimento.


Content Studio serve usuário final.


O Studio pode ajudar a testar:


- props;
- Zod schemas;
- motion;
- layout;
- variants.


Mas o produto final não deve exigir que cliente veja Remotion Studio.


## 29. Primeiro fluxo end-to-end


### Still


~~~
fixture JSON
→ StaticRenderManifestSchema
→ resolve editorial.documentary-card
→ compile fixture identity
→ resolve hero
→ build RendererProps
→ Thumbnail preview
→ renderStill()
→ PNG
~~~


### Video


~~~
timeline fixture
→ TimelineManifestSchema
→ resolve template segment
→ compile same identity
→ resolve same hero
→ Player preview
→ slow_push
→ renderMedia()
→ MP4
~~~


## 30. Testes de paridade


Testar:


- mesmo título;
- mesma fonte;
- mesmo crop inicial;
- mesmas safe areas;
- mesmas cores;
- mesma assinatura;
- still versus frame inicial/final de vídeo;
- preview versus render final.


## 31. Não objetivos


- escolher infraestrutura definitiva de render;
- construir editor de timeline completo;
- criar provider de fontes inteiro;
- suportar todos os efeitos Remotion;
- usar Editor Starter como domínio;
- implementar rendering distribuído;
- expor APIs Remotion ao manifest.


## 32. Decisões V0


1. Player é preview/interação, não persistência.
2. Content Studio possui Authoring State próprio.
3. inputProps recebem estado já resolvido.
4. Static usa Thumbnail/Still para preview e renderStill para output.
5. Video usa Player/Composition e renderMedia.
6. Sequence mapeia intervalos da Timeline.
7. MotionSpec é traduzido por template/adapter.
8. Font resolution é uma camada própria.
9. Asset resolution é uma camada própria.
10. Preview e render final reutilizam a mesma árvore visual.
11. Remotion Studio é ferramenta de desenvolvimento.
12. Editor Starter é acelerador potencial, não fundamento arquitetural.
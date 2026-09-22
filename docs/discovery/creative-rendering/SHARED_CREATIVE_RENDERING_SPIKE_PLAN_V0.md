# Shared Creative Rendering Spike Plan V0


**Status:** Ready for implementation audit
**Produto:** Content Agent Studio
**Escopo:** provar uma camada compartilhada de composição/render para still e vídeo usando Remotion como primeiro adapter candidato
**Natureza:** spike técnico controlado, sem migrations e sem acoplamento a um Project específico


---


## 1. Objetivo


Provar, com a menor integração possível, que o Content Agent Studio consegue usar contratos neutros, Project Identity compilada, Template Registry, assets resolvidos e um mesmo template React para gerar:


1. uma peça estática 1080x1350;
2. uma composição vertical 1080x1920 de aproximadamente 6 segundos;
3. preview interativo;
4. PNG;
5. MP4.


O spike termina com evidência suficiente para decidir se Remotion deve avançar como primeiro renderer oficial da Creative Rendering Layer.


---


## 2. Autoridades conceituais


Antes de implementar, ler:


~~~
docs/discovery/VIDEO_PRODUCTION_V0_DOMAIN.md
docs/discovery/KNOWLEDGE_EXPLAINER_HYBRID_V0_COMPLETE (1).md


RENDER_ARCHITECTURE_V0.md
STATIC_RENDER_MANIFEST_V0.md
TIMELINE_MANIFEST_V0_REFINEMENT.md
TEMPLATE_REGISTRY_V0.md


CREATIVE_PRIMITIVES_SCHEMA_V0.md
STATIC_RENDER_SCHEMA_V0.md
TIMELINE_SCHEMA_V0.md
TEMPLATE_DESCRIPTOR_SCHEMA_V0.md


EDITORIAL_DOCUMENTARY_CARD_V0.md
REMOTION_ADAPTER_MAPPING_V0.md


PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json
~~~


Os documentos de arquitetura são orientação de domínio.


O repositório atual continua sendo a autoridade sobre convenções de diretório, aliases, bibliotecas instaladas, estilo Zod, padrões React, testes, scripts, build, lint e runtime.


Nenhum path proposto nos documentos deve ser criado cegamente sem reconciliação com o código real.


---


## 3. Princípios não negociáveis


### 3.1 Neutralidade de Project


O Portal Comunidades Alternativas é apenas fixture/referência.


É proibido criar no core:


- branch por nome de Project;
- template hardcoded do Portal;
- namespace obrigatório do Portal;
- rota específica do Portal;
- import direto do CMS do Portal;
- dependência do banco do Portal.


### 3.2 Sem migrations no spike


Não criar:


- tabela VideoWork;
- tabela StaticRenderManifest;
- tabela Template;
- tabela RenderExecution;
- migrations de Project Identity;
- novas entidades persistentes apenas para suportar o experimento.


Fixtures e estruturas em memória são suficientes.


### 3.3 Renderer não é domínio


Nenhum manifest neutro deve carregar:


- TSX;
- component path;
- Remotion composition id;
- interpolate config;
- spring config;
- Chromium flags;
- worker URL;
- Lambda config;
- FFmpeg commands.


### 3.4 Preview e output devem compartilhar árvore visual


Evitar preview falso.


Objetivo:


~~~
resolved template
├── preview
└── final render
~~~


### 3.5 Não reconstruir um editor completo


O spike não é Canva, CapCut, Premiere ou timeline editor final.


Interações devem ser mínimas e provar somente que Authoring State pode alimentar preview.


---


## 4. Referência visual dos 10 slides


Antes da implementação visual definitiva da Wave 4, poderá ser fornecido um conjunto de 10 slides reais já produzidos.


Eles devem ser tratados como:


~~~
Visual Reference Pack
~~~


e não como contrato de domínio.


O estudo deve extrair, quando sustentado visualmente:


- grid;
- margens;
- hierarchy;
- typography roles;
- image treatment;
- logo placement;
- source/credit behavior;
- recurring slide types;
- safe areas;
- density;
- rhythm entre slides;
- elementos que são identidade do Project;
- elementos que são padrão genérico de template.


Não transformar automaticamente peculiaridades dos 10 slides em regra global.


Resultado esperado:


~~~
Reference Pack
→ Template Design Decisions
→ editorial.documentary-card@0.1.0
~~~


Se o Reference Pack chegar depois do início do spike, ele pode recalibrar apenas a Wave 4 em diante.


---


# EXECUTION WAVES


## Wave 0 — Repo Audit / No Writes


### Objetivo


Reconhecer o estado real antes de instalar ou criar qualquer coisa.


### Verificar


- branch e status;
- package manager;
- React/Next versions;
- Zod e padrões de schema;
- organização de lib/domain;
- ImageDraft/VideoDraft atuais;
- rotas /imagens e /videos;
- Production context;
- Project Identity compiler atual;
- asset/library model;
- scripts de test/build/lint;
- se Remotion já aparece em qualquer dependência;
- server/runtime constraints;
- Vercel implications;
- arquivos discovery existentes.


### Output


Criar somente um relatório de auditoria curto:


~~~
SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md
~~~


### Gate 0


Não iniciar Wave 1 até confirmar que a proposta pode ser encaixada sem substituir arquitetura existente.


### Proibido


- migrations;
- refactor amplo;
- alterar VideoDraft;
- mover arquivos existentes;
- criar UI;
- instalar Remotion.


---


## Wave 1 — Remotion Isolation Spike


### Objetivo


Provar que Remotion pode existir no repo sem contaminar o domínio.


### Ações


- instalar dependências mínimas necessárias;
- criar entrypoint isolado;
- criar um hello-world visual mínimo;
- provar preview local;
- provar still simples;
- provar vídeo curto simples;
- registrar impacto de build.


### Resultado


Nenhuma integração com Project/Production ainda.


### Gate 1


Deve ser possível gerar:


~~~
1 still
1 mp4 curto
~~~


usando dados estáticos locais.


### Proibido


- ligar banco;
- criar Template Registry definitivo;
- importar fixture do Portal;
- alterar /videos;
- alterar /imagens.


---


## Wave 2 — Neutral Schemas


### Objetivo


Implementar os contratos TypeScript/Zod do spike.


### Schemas esperados


~~~
CanvasSpec
TemplateRef
IdentitySnapshotRef
AssetRef
VisualTokensSnapshot
MotionSpec
TransitionSpec


StaticRenderManifest
TimelineManifest
TemplateDescriptor
~~~


### Requisitos


- schemas neutros;
- .strict() quando compatível;
- unions discriminadas na Timeline;
- testes unitários;
- nenhum import de Remotion nos schemas.


### Gate 2


Fixtures válidas passam.


Fixtures deliberadamente inválidas falham de forma previsível.


### Proibido


- persistência;
- chamadas de banco;
- transformar schemas em models ORM.


---


## Wave 3 — Runtime Resolution Layer


### Objetivo


Provar a cadeia entre manifest e template.


### Componentes mínimos


~~~
Template Registry
Identity Resolver / fixture compiler
Asset Resolver de fixture
Resolved Render Input builder
validation result
~~~


### Template Registry


Deve resolver:


~~~
editorial.documentary-card@0.1.0
~~~


mas ainda pode retornar um componente placeholder.


### Identity


Usar um snapshot/fixture controlado.


Não alterar Project Identity real nesta wave.


### Assets


Resolver apenas asset de fixture/local necessário.


### Gate 3


Dado um manifest válido, produzir:


~~~
ResolvedStaticRenderInput
~~~


e, para timeline:


~~~
ResolvedTimelineInput
~~~


sem Remotion dentro dos contratos neutros.


---


## Wave 4 — Editorial Documentary Card V0


### Objetivo


Construir o primeiro template visual real.


### Inputs


- EDITORIAL_DOCUMENTARY_CARD_V0.md;
- Visual Reference Pack dos 10 slides, se já fornecido;
- fixture Terra Una;
- VisualTokens fixture.


### Implementar inicialmente


~~~
variant: cover
modes: still + video
canvases:
  1080x1350
  1080x1920
~~~


### Camadas


~~~
Hero
Contrast Overlay
Editorial Content
Source/Credit
Brand Signature
~~~


### Conteúdo


~~~
eyebrow?
title
subtitle?
source_line?
footer?
~~~


### Asset


~~~
hero
~~~


### Motion inicial


~~~
none
slow_push
fade
~~~


Somente declarar motion que estiver realmente implementado.


### Gate 4


O mesmo template deve renderizar de maneira reconhecivelmente consistente em 4:5 e 9:16.


### Proibido


- hardcode Terra Una;
- hardcode Portal;
- copiar CSS de um slide específico sem abstração;
- implementar variants não testadas.


---


## Wave 5 — Static Render Path


### Objetivo


Fechar o primeiro fluxo útil completo de still.


### Pipeline


~~~
StaticRenderManifest
→ validate
→ resolve template
→ resolve tokens
→ resolve assets
→ build renderer props
→ preview
→ renderStill
→ PNG
~~~


### Preview


Usar a árvore visual real.


### Gate 5


Gerar um PNG 1080x1350 consistente com o preview.


### Evidência


Salvar:


- input fixture;
- screenshot/PNG;
- diagnostics;
- teste de parsing;
- teste de render.


---


## Wave 6 — Authoring Preview Proof


### Objetivo


Provar que o JSON não é a interface do usuário.


### UI mínima


Pode ser rota técnica, story/dev screen ou painel isolado.


Controles mínimos:


~~~
Title input
Subtitle input
Hero asset switch
Variant selector se houver mais de uma
Canvas selector
~~~


Opcional:


~~~
focal point control
~~~


### Fluxo


~~~
UI
→ Authoring State
→ manifest/normalized state
→ Player/Thumbnail props
→ live preview
~~~


### Gate 6


Editar o título deve alterar o preview sem editar código ou JSON manualmente.


Trocar hero deve alterar o preview.


### Proibido


- salvar em banco;
- construir editor visual completo;
- drag/resize livre.


---


## Wave 7 — Timeline / Video Path


### Objetivo


Usar o mesmo template numa TimelineManifest real.


### Fixture mínima


~~~
1080x1920
30 fps
180 frames
1 visual track
1 template segment
1 hero
1 slow_push
audio=false
~~~


### Pipeline


~~~
TimelineManifest
→ validate
→ resolve
→ Composition
→ Sequence
→ template
→ Player
~~~


### Gate 7


Preview reproduz 6 segundos.


Título, crop, tokens e assinatura continuam coerentes com a versão still.


---


## Wave 8 — Video Render


### Objetivo


Gerar output de vídeo real.


### Pipeline


~~~
Timeline fixture
→ renderMedia
→ MP4
~~~


### Gate 8


MP4 válido e reproduzível.


Registrar:


- fps;
- dimensions;
- duration;
- renderer version;
- warnings;
- render duration;
- output path/ref.


### Proibido


- Lambda;
- render farm;
- worker distribuído;
- infraestrutura definitiva.


---


## Wave 9 — Visual QA / Parity


### Objetivo


Responder se a hipótese central foi provada.


### Comparar


Still vs Video:


- família tipográfica;
- peso;
- escala percebida;
- safe area;
- hero crop;
- focal point;
- overlay;
- title wrapping;
- source/credit;
- logo/brand;
- colors;
- frame inicial;
- frame final;
- preview;
- output final.


### Testes de stress


- título curto;
- título longo;
- sem subtítulo;
- imagem horizontal;
- imagem vertical;
- focal point extremo;
- missing optional content;
- unsupported canvas;
- unsupported motion.


### Gate 9


Nenhuma divergência silenciosa entre preview e final render.


Problemas conhecidos precisam ser registrados.


---


## Wave 10 — Architecture Verdict


### Objetivo


Encerrar o spike antes de expandir escopo.


### Produzir


~~~
SHARED_CREATIVE_RENDERING_SPIKE_RESULTS.md
~~~


### O relatório deve responder


1. Remotion funciona adequadamente como primeiro renderer?
2. Still e vídeo realmente compartilharam template?
3. Preview e output tiveram paridade aceitável?
4. Project Identity pode alimentar tokens sem acoplamento?
5. Asset resolution permaneceu neutra?
6. Template Registry funcionou sem banco?
7. Motion semântico foi suficiente?
8. Quais limitações apareceram?
9. Qual infraestrutura de render merece estudo posterior?
10. Qual deve ser a próxima integração real?


### Vereditos técnicos permitidos


~~~
PROCEED
PROCEED_WITH_CONSTRAINTS
REVISIT_RENDERER
~~~


O relatório deve justificar o veredito por evidência do spike.


---


## 5. Arquivos esperados


Os paths finais dependem da auditoria do repo.


Conceitualmente o spike deve terminar com equivalentes a:


~~~
creative/
  schemas/
  identity/
  assets/
  templates/
  renderers/remotion/
  fixtures/
  tests/
~~~


Mais:


~~~
SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md
SHARED_CREATIVE_RENDERING_SPIKE_RESULTS.md
~~~


Não criar árvore paralela desnecessária se o repo já possuir local canônico.


---


## 6. Fixture strategy


Primeira fixture:


~~~
Project:
Comunidades Alternativas


Content:
Terra Una


Template:
editorial.documentary-card
~~~


Mas a fixture deve permanecer identificada como fixture.


Antes de encerrar o spike, testar o template com pelo menos um segundo conjunto de tokens/conteúdo que não seja do Portal.


Isso é obrigatório para provar que o template não foi acidentalmente desenhado como Portal hardcoded.


---


## 7. Definition of Done


O spike só está fechado quando existir evidência de:


- schemas neutros funcionando;
- registry funcionando;
- template genérico funcionando;
- Project Identity fixture → tokens;
- asset fixture → resolved asset;
- 1080x1350 still;
- 1080x1920 preview;
- 1080x1920 MP4;
- live authoring proof;
- slow_push;
- focal point;
- visual parity;
- segundo Project/context testado;
- relatório final.


---


## 8. Fora do escopo


Não implementar nesta rodada:


- Production integration completa;
- VideoWork persistence;
- Distribution;
- social publishing;
- template marketplace;
- font picker completo;
- Google Fonts catalog completo;
- Project font upload completo;
- drag-and-drop editor completo;
- multi-slide carousel editor completo;
- multi-scene timeline editor completo;
- approval workflow;
- render queue final;
- distributed rendering;
- billing;
- provider abstraction geral.


---


## 9. Próxima fronteira após o spike


Se o veredito for PROCEED ou PROCEED_WITH_CONSTRAINTS, a próxima conversa deve escolher uma integração vertical real.


### A. Carousel Authoring


~~~
EditorialContent
→ ChannelPiece
→ multi-slide authoring
→ StaticRenderManifest per slide
→ render set
→ ChannelPieceMedia
~~~


### B. Video Authoring


~~~
VideoDraft
→ Scene Plan
→ Timeline Manifest
→ preview
→ rough cut
~~~


### C. Shared Template System


Aprofundar:


- slide types;
- scene modes;
- template families;
- responsive composition;
- typography catalog;
- font picker;
- reusable motion language.


A escolha deve ser feita depois dos resultados do spike, não antes.


---


## 10. Handoff instruction for Cloud


O agente de implementação deve começar em modo leitura.


Primeiro:


1. ler documentos de autoridade;
2. executar Wave 0;
3. registrar divergências entre docs e repo;
4. não modificar código durante a auditoria;
5. apresentar o plano reconciliado;
6. então iniciar Wave 1.


Cada Wave deve fechar com:


~~~
changes
tests
evidence
known limitations
gate result
~~~


Não avançar silenciosamente por um Gate falho.


O objetivo do spike não é maximizar quantidade de features.


O objetivo é reduzir incerteza arquitetural com o menor conjunto de implementação capaz de provar a hipótese.
# Render Architecture V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** camada compartilhada de composição e render para peças estáticas e vídeo
**Base conceitual:** VIDEO_PRODUCTION_V0_DOMAIN + KNOWLEDGE_EXPLAINER_HYBRID_V0_COMPLETE


---


## 1. Objetivo


Definir a fronteira entre o domínio editorial/audiovisual do Content Agent Studio e as tecnologias usadas para compor, visualizar e renderizar mídia.


Esta arquitetura não substitui Production, EditorialContent, ChannelPiece, VideoDraft ou o futuro VideoWork. Ela cria uma camada compartilhada abaixo desses domínios para transformar conteúdo estruturado, identidade visual, assets e templates em outputs reproduzíveis.


O primeiro renderer candidato para validação é Remotion, mas Remotion não é a fonte de verdade do domínio.


## 2. Princípio de desacoplamento de projetos


O Content Agent Studio deve permanecer genérico.


Projetos reais podem ser usados como fixtures, casos de uso e validações, mas não devem gerar regras especiais no core.


O Portal Comunidades Alternativas será tratado somente como um Project de referência.


~~~
Project data / identity / assets / content
        ↓
generic Content Studio contracts
        ↓
generic template
        ↓
renderer adapter
~~~


Nunca criar branches, rotas, componentes ou contratos obrigatórios específicos do Portal no core.


Templates podem ser genéricos ou, futuramente, registrados no escopo de um Project. Mesmo nesse caso, o mecanismo de registro permanece genérico.


## 3. Arquitetura em três planos


### 3.1 Control Plane — domínio do Content Studio


Fonte de verdade sobre Project, Project Identity, Production, EditorialContent, ChannelPiece, VideoDraft, futuro VideoWork, Scene Plan, Timeline Manifest, artifacts, approvals, outputs aprovados, histórico e versões.


### 3.2 Creative Rendering Layer — nova fronteira


Responsável por traduzir dados de domínio para uma composição visual reproduzível.


~~~
Identity Compiler
Visual Tokens
Template Registry
Template Binding
Static Render Manifest
Timeline Manifest
Renderer Adapter
Preview
Render Execution
~~~


Esta camada não decide conteúdo editorial e não controla workflow.


### 3.3 Execution / Media Plane


Executa trabalho técnico.


Primeiro candidato: Remotion.


Outros adapters podem existir, por exemplo FFmpeg, HTML/CSS renderer, editor export ou outro renderer futuro.


Uma falha ou substituição do renderer não deve invalidar o domínio nem os manifests neutros.


## 4. Dois caminhos de domínio, uma infraestrutura visual


### 4.1 Peça estática / carrossel


~~~
Project
└── Production
    └── EditorialContent
        └── ChannelPiece
            ↓
      StaticRenderManifest
            ↓
       Template Registry
            ↓
       Renderer Adapter
            ↓
       PNG / JPEG / WebP
            ↓
        LibraryFile
            ↓
     ChannelPieceMedia
~~~


Uma peça estática não precisa de VideoWork nem de Timeline Manifest.


### 4.2 Vídeo


~~~
Project
└── Production
    └── VideoWork
        ├── Script
        ├── Scene Plan
        ├── Asset Manifest
        └── Timeline Manifest
                ↓
          Template Registry
                ↓
          Renderer Adapter
                ↓
          Preview / MP4 / WebM
                ↓
          ProductionArtifact
                ↓ approval
            LibraryFile
                ↓
         ChannelPieceMedia
~~~


### 4.3 O que é compartilhado


Os dois caminhos podem compartilhar Project Identity, Visual Tokens, AssetRef, CanvasSpec, TemplateRef, ContentBindings, Template Registry, componentes React, regras de safe area, tipografia, layouts, previews e renderer adapters.


Eles não precisam compartilhar a mesma entidade de domínio.


## 5. Project Identity versus Visual Tokens


Project Identity continua sendo semântica e persistente: propósito, audiência, voz, princípios, restrições, identidade visual e preferências de geração.


O renderer precisa de valores operacionais mais concretos, como:


~~~
typography.display
typography.body
spacing.page
spacing.gap
logo.placement
image.default_fit
surface.radius
safe_area
~~~


Direção:


~~~
Project Identity
      ↓
compileVisualIdentity()
      ↓
VisualTokensSnapshot
      ↓
Template
~~~


O nome final do compiler permanece aberto.


O compiler não substitui Project Identity. Ele gera uma representação operacional para composição.


## 6. Snapshot e reprodutibilidade


Um render aprovado deve continuar reproduzível mesmo que a identidade do Project mude no futuro.


Todo render manifest deve fixar, direta ou indiretamente:


- schema_version;
- template id;
- template version;
- identity snapshot ou versão de identidade;
- referências de assets;
- dimensões;
- parâmetros de conteúdo;
- output intent.


Idealmente assets relevantes também preservam checksum ou versão quando o storage permitir.


Regra: um render nunca deve depender silenciosamente do estado atual de uma identidade ou template mutável.


## 7. Template como código, conteúdo como dados


O manifest descreve o que será composto.


O template descreve como será desenhado.


Evitar no manifest:


~~~
fontSize: 64
left: 88
top: 910
lineHeight: 0.94
~~~


Preferir:


~~~
template: editorial.documentary-card
variant: cover
content.title: ...
content.subtitle: ...
assets.hero: ...
~~~


O template React contém layout, tipografia, spacing, regras de overflow e motion defaults.


Exceções de layout podem existir somente quando previstas pelo schema do template.


## 8. Remotion como adapter candidato


Remotion deve ser tratado como implementação de renderer, não como modelo de domínio.


~~~
Neutral Manifest
      ↓
Remotion Adapter
      ↓
Template React
      ↓
Still / Composition
      ↓
Rendered Output
~~~


A camada neutra não armazena TSX, hooks, imports ou APIs específicas do Remotion.


Metadados como engine, engine_version, worker, execution_id, warnings e duração de render pertencem à Execution ou ao Artifact.


## 9. Contratos compartilhados V0


Primitivas recomendadas:


~~~
AssetRef
CanvasSpec
IdentitySnapshotRef
TemplateRef
ContentBindings
OutputSpec
StaticRenderManifest
TimelineManifest
~~~


Não criar tabelas específicas para todas essas estruturas no primeiro spike.


Inicialmente podem existir como schemas TypeScript/Zod, fixtures JSON, artifacts JSON e contratos de adapter.


Persistência definitiva deve ser decidida depois da validação vertical.


## 10. Preview


Preview e render final devem consumir o mesmo contrato de dados.


~~~
manifest
  ├── preview
  └── final render
~~~


Evitar uma UI que apenas imita o resultado usando outro layout engine.


Quando tecnicamente viável, preview e render final devem reutilizar o mesmo template/component tree.


## 11. Primeira validação vertical


Nome sugerido: Shared Creative Rendering Spike.


Escopo mínimo:


1. registrar um template genérico chamado editorial.documentary-card;
2. criar um StaticRenderManifest realista;
3. compilar identidade/tokens de fixture;
4. renderizar 1080x1350;
5. reutilizar o mesmo template em uma cena 1080x1920;
6. gerar preview;
7. gerar um still;
8. gerar um vídeo curto;
9. comparar consistência entre still e vídeo;
10. registrar limitações do adapter.


Sem migrations no primeiro passo.
Sem integração obrigatória com banco.
Sem automação de distribuição.


## 12. Critérios de sucesso


O spike é aprovado se provar:


- um único template-base serve still e vídeo;
- conteúdo e layout permanecem separados;
- Project Identity alimenta tokens sem regra hardcoded por projeto;
- o mesmo manifest gera preview e output coerentes;
- assets são referenciados sem acoplamento ao storage específico;
- o adapter Remotion pode ser trocado sem alterar o domínio;
- erros de conteúdo e erros de render podem ser distinguidos;
- o resultado pode ser reproduzido com versões fixadas.


## 13. Não objetivos do V0


Fora do escopo inicial:


- editor de timeline completo;
- alternativa a Premiere, DaVinci ou CapCut;
- sincronização bidirecional com editor externo;
- sistema universal ou marketplace de templates;
- migrations completas de VideoWork;
- render distribuído em escala;
- publicação automática em redes;
- hardcode de qualquer projeto de referência;
- unificação artificial de carrossel e vídeo numa única entidade.


## 14. Decisões fechadas


1. Portal Comunidades Alternativas é Project de referência, não dependência do produto.
2. Static piece e VideoWork continuam domínios diferentes.
3. A infraestrutura visual é compartilhável.
4. Timeline Manifest continua sendo a fonte neutra da montagem de vídeo.
5. Peças estáticas recebem contrato próprio: StaticRenderManifest.
6. Template Registry é compartilhado.
7. Project Identity é compilada para Visual Tokens.
8. Templates são versionados.
9. Render manifests fixam identidade e template suficientes para reprodutibilidade.
10. Remotion entra como primeiro adapter a validar, não como domínio.
11. Primeiro passo é um spike sem migrations.
12. Código específico do Portal no core é proibido por princípio arquitetural.


## 15. Documentos complementares


~~~
STATIC_RENDER_MANIFEST_V0.md
TIMELINE_MANIFEST_V0_REFINEMENT.md
TEMPLATE_REGISTRY_V0.md
PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json
~~~
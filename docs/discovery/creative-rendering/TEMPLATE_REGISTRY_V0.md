# Template Registry V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** contrato de descoberta, validação e resolução de templates visuais reutilizáveis


---


## 1. Objetivo


Criar uma fronteira explícita entre domínio, identidade, conteúdo, design e renderer.


O Template Registry responde:


> Quais templates existem, quais versões e variantes oferecem, que props aceitam e quais modos de render suportam?


Ele não decide qual conteúdo deve ser produzido e não executa render.


## 2. Regra de neutralidade de Project


O Registry não deve depender de projetos conhecidos pelo core.


Projetos reais são dados.


~~~
generic registry
+ project identity
+ project content
= project-specific output
~~~


Não criar registries hardcoded por projeto.


## 3. Escopos


V0 prevê dois escopos:


~~~
system
project
~~~


### system


Template genérico distribuído com o Content Studio.


Exemplos:


~~~
editorial.documentary-card
editorial.quote-card
social.cover-card
~~~


### project


Template registrado para um Project específico por mecanismo genérico.


Exemplo conceitual:


~~~
scope: project
project_ref: project_123
id: campaign.signature-card
~~~


O core não precisa conhecer o significado desse template.


Project-scoped templates podem ser adiados na implementação inicial. O contrato apenas não deve bloquear essa evolução.


## 4. Template Descriptor V0


~~~
{
  "id": "editorial.documentary-card",
  "version": "0.1.0",
  "scope": "system",


  "label": "Documentary Card",


  "supported_modes": [
    "still",
    "video"
  ],


  "variants": [
    "cover",
    "standard"
  ],


  "canvas_support": {
    "strategy": "declared_sizes",
    "sizes": [
      { "width": 1080, "height": 1350 },
      { "width": 1080, "height": 1920 },
      { "width": 1920, "height": 1080 }
    ]
  },


  "schemas": {
    "content": "editorial.documentary-card.content.v0",
    "assets": "editorial.documentary-card.assets.v0"
  },


  "capabilities": {
    "motion_presets": [
      "none",
      "fade",
      "slow_push"
    ],
    "supports_transparency": false
  },


  "component_key": "editorial-documentary-card"
}
~~~


component_key é detalhe interno do registry/adapter. O manifest não recebe import path.


## 5. Template identity


Template é identificado por:


~~~
scope + id + version
~~~


Variant não cria nova identidade de template.


Exemplo:


~~~
editorial.documentary-card@0.1.0
variant=cover
~~~


Versionamento deve usar regra explícita. Semver é candidato natural no V0.


## 6. TemplateRef


Manifests usam somente:


~~~
{
  "id": "...",
  "version": "...",
  "variant": "...",
  "scope": "system"
}
~~~


Eles não armazenam componentPath, filePath, npmPackage ou TSX source.


Esses detalhes ficam no Registry.


## 7. Content schema


Cada template define slots semânticos.


Exemplo:


~~~
type DocumentaryCardContent = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  source_line?: string;
  footer?: string;
};
~~~


O schema deve incluir limites e políticas úteis.


Exemplo conceitual:


~~~
title:
  required
  max_recommended: 72
  overflow_policy: human_review
~~~


Evitar objetos arbitrários sem validação.


## 8. Asset schema


Exemplo:


~~~
{
  "hero": {
    "required": true,
    "kinds": ["image"],
    "fit": ["cover", "contain"]
  },


  "logo": {
    "required": false,
    "source_preference": "identity"
  }
}
~~~


Um template não deve exigir que o logo seja repetido em todo manifest se ele pode ser resolvido pela identidade do Project.


## 9. Identity requirements


Templates podem declarar quais tokens consomem.


Exemplo:


~~~
identity_requirements: [
  "typography.display",
  "typography.body",
  "spacing.page",
  "brand.logo",
  "brand.mark",
  "surface.background"
]
~~~


Isso permite detectar antes do render se Project Identity compilada está incompleta.


O template não deve ler a Project Identity inteira diretamente.


~~~
Project Identity
→ Visual Identity Compiler
→ VisualTokensSnapshot
→ Template
~~~


## 10. Visual Tokens


Estrutura conceitual:


~~~
{
  "typography": {
    "display": {
      "family": "...",
      "weight": 600
    },
    "body": {
      "family": "...",
      "weight": 400
    }
  },


  "spacing": {
    "page": 72,
    "gap": 32
  },


  "brand": {
    "logo_asset_ref": "...",
    "mark_asset_ref": "..."
  },


  "surface": {
    "background": "...",
    "foreground": "..."
  }
}
~~~


Esses valores são outputs do compiler, não necessariamente campos persistidos diretamente na Project Identity.


## 11. React component boundary


A implementação inicial provavelmente será React.


Conceitualmente:


~~~
type TemplateComponentProps<TContent> = {
  content: TContent;
  assets: ResolvedAssets;
  tokens: VisualTokens;
  canvas: CanvasSpec;


  mode: "still" | "video";


  frame?: number;
  durationFrames?: number;
  motion?: MotionSpec;
};
~~~


O component não busca dados diretamente do banco.


Tudo necessário chega por props resolvidas.


Isso melhora testes, preview, render server-side, determinismo, isolamento e portabilidade.


## 12. Registry API conceitual


~~~
registerTemplate(descriptor, component)


resolveTemplate(templateRef)


validateTemplateBindings(templateRef, content, assets)


listTemplates(filters?)


listTemplateVariants(templateRef)
~~~


No V0, Registry pode ser estático em código.


Não exige tabela ou marketplace.


## 13. Resolução


~~~
Manifest
   ↓
TemplateRef
   ↓
resolveTemplate()
   ↓
TemplateDescriptor
   ├── content schema
   ├── asset schema
   ├── capabilities
   └── component
   ↓
validate bindings
   ↓
render adapter
~~~


Erros de resolução devem ser explícitos:


~~~
template_not_found
template_version_not_found
variant_not_supported
content_invalid
asset_binding_invalid
canvas_not_supported
motion_not_supported
identity_tokens_missing
~~~


## 14. Versionamento


Nunca alterar silenciosamente o comportamento de uma versão publicada do template.


Exemplo:


~~~
0.1.0
0.1.1
0.2.0
1.0.0
~~~


Render manifests fixam a versão.


Uma atualização do Studio não deve automaticamente fazer um render histórico mudar de layout.


## 15. Variants


Variants representam variações previstas do mesmo design.


Exemplos:


~~~
cover
standard
quote
source
closing
~~~


V0 deve começar com poucas variants.


Não usar variant para representar canal inteiro quando a diferença é apenas canvas.


## 16. Canvas


Estratégias futuras possíveis:


~~~
fixed
declared_sizes
fluid
~~~


Para o primeiro spike:


~~~
declared_sizes
~~~


Primeiro template deve provar pelo menos:


~~~
1080x1350
1080x1920
~~~


Depois pode ser validado em 1920x1080.


## 17. Still e video


supported_modes declara capacidade:


~~~
still
video
~~~


Um template que suporta ambos deve produzir identidade visual equivalente nos dois modos.


Video adiciona frame, duração, motion, transições externas e timing.


Still não precisa fingir duração.


## 18. Motion presets


Templates declaram presets suportados.


Exemplo:


~~~
none
fade
slow_push
slow_pan
reveal
~~~


O significado visual pertence ao template/adapter.


Manifest usa linguagem semântica curta.


Evitar transportar implementation details de animação para o domínio.


## 19. Primeiro template


Id:


~~~
editorial.documentary-card
~~~


Objetivo:


- fotografia dominante;
- título;
- subtítulo opcional;
- eyebrow opcional;
- linha de fonte;
- assinatura visual via identity;
- baixa complexidade;
- uso editorial/documental;
- still e vídeo.


Ele não pertence ao Portal.


O Portal é apenas a primeira fixture.


Outro Project pode reutilizá-lo com tokens, textos e assets diferentes.


## 20. Testes mínimos


O Registry deve permitir testes sem renderer real:


- resolve id + version;
- rejeita versão inexistente;
- rejeita variant inválida;
- valida content;
- valida assets;
- valida canvas;
- valida motion;
- detecta token obrigatório faltante;
- não muta descriptor;
- dois Projects usam o mesmo template com identities diferentes.


## 21. Relação com Remotion


Remotion Adapter recebe template já resolvido.


~~~
resolveTemplate()
        ↓
ResolvedTemplate
        ↓
Remotion Adapter
        ↓
Still / Composition
~~~


O Registry não importa APIs de render.


A implementação React do template pode ser compatível com Remotion, mas descriptor e manifests permanecem neutros.


## 22. Estrutura de código sugerida para auditoria do agente


Não é instrução para criar sem auditoria.


Possível direção:


~~~
lib/
  creative/
    schemas/
    identity/
    templates/
      registry.ts
      system/
        editorial-documentary-card/
    renderers/
      remotion/
~~~


O agente deve primeiro confrontar isso com convenções atuais do repo.


## 23. Não objetivos


- template marketplace;
- editor visual de template;
- upload arbitrário de React;
- execução de código não confiável;
- template remoto;
- versionamento distribuído;
- plugins npm arbitrários de terceiros;
- Project-specific branches no core.


## 24. Decisões V0


1. Registry compartilhado entre still e vídeo.
2. Templates identificados por id + versão + scope.
3. Variants fazem parte do template.
4. Content e assets possuem schemas.
5. Project Identity é compilada antes de chegar ao template.
6. Template recebe dados por props; não busca banco.
7. System templates são genéricos.
8. Project templates futuros entram via mecanismo genérico.
9. Primeiro template é editorial.documentary-card.
10. Portal é fixture, não proprietário do template.
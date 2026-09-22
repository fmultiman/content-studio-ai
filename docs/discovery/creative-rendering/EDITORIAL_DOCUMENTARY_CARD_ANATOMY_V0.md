# Editorial Documentary Card — Anatomy V0

**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Template family:** editorial.documentary-card
**Versão inicial:** 0.1.0
**Visual reference:** Portal Carousel Pack B — organic collage direction
**Escopo:** anatomia técnica das duas primeiras variants: cover e info

---

## 1. Objetivo

Detalhar o primeiro template real da Creative Rendering Layer sem transformar o Portal Comunidades Alternativas em regra do produto.

O Pack B funciona como referência visual concreta.

A implementação deve extrair dele uma gramática reutilizável:

- composição editorial;
- colagem orgânica;
- hierarquia tipográfica;
- artifact/document emphasis;
- layers de papel;
- pequenas anotações;
- decoração controlada;
- assimetria deliberada.

O resultado deve continuar genérico.

---

## 2. Separação fundamental

O V0 deve distinguir quatro coisas.

~~~
COMPOSITION
editorial.documentary-card

VARIANT
cover | info

STYLE DIRECTION
organic-collage

PROJECT IDENTITY
typography, colors, logo, brand assets
~~~

No primeiro spike, organic-collage pode ser uma direção visual implementada dentro da versão 0.1.0.

Não é obrigatório adicionar agora um novo campo style_pack ao manifest.

Primeiro provar a separação em código.

Se um segundo style real for implementado com a mesma composition, então formalizar StylePack como contrato próprio.

---

## 3. O que o Pack B ensina

O Pack B possui uma gramática diferente de um slide genérico de IA.

Características observáveis:

- superfícies de papel sobrepostas;
- bordas rasgadas;
- fita adesiva;
- cards presos por pino;
- fotografias/documentos levemente rotacionados;
- anotações manuscritas periféricas;
- uso de assimetria;
- sobreposição controlada;
- textura material;
- contraste entre serif editorial e sans para leitura;
- ornamentação não central;
- marca integrada como parte da composição;
- decoração que sugere arquivo, pesquisa, caderno, scrapbook ou dossiê.

Essas características devem orientar a estética.

Elas não são campos de conteúdo.

---

## 4. Component anatomy

Hierarquia conceitual:

~~~
DocumentaryCard
├── Canvas
│   ├── SurfaceLayer
│   ├── AmbientDecorationLayer
│   ├── ContentLayer
│   ├── ArtifactLayer
│   ├── AnnotationLayer
│   ├── SequenceMarker
│   └── BrandLayer
~~~

O componente React pode ter outra estrutura interna.

Esta hierarquia representa responsabilidades visuais.

---

## 5. Props de runtime

Conceitualmente:

~~~
DocumentaryCardProps
  variant
  content
  assets
  tokens
  canvas
  mode
  motion?
  sequence?
  styleContext?
~~~

Onde:

- variant escolhe a estrutura;
- content traz texto;
- assets traz hero e supporting assets;
- tokens traz Project Identity compilada;
- canvas fixa dimensões;
- mode é still ou video;
- motion existe apenas quando apropriado;
- sequence fornece posição da peça numa série;
- styleContext resolve a linguagem material/decorativa.

---

## 6. Sequence marker

A paginação 1/10, 2/10 etc. não deve ser conteúdo editorial hardcoded.

Ela deve vir do contexto da peça.

Exemplo conceitual:

~~~
sequence:
  index: 1
  total: 10
~~~

O template renderiza 1/10 ou outra apresentação.

O estilo visual do marcador pertence ao template/style.

Assim o Content Studio pode trocar:

- capsule;
- torn-paper tag;
- minimal text;
- no marker.

Sem alterar o conteúdo.

Importante:

> pagination data pertence ao authoring/channel context; pagination appearance pertence ao template/style.

---

## 7. Shared content contract

Campos compartilhados entre variants:

~~~
eyebrow?
title
subtitle?
source_line?
footer?
~~~

Regras:

- title é obrigatório;
- eyebrow é curto;
- subtitle é explicativo;
- source_line é documental/crédito;
- footer é opcional e secundário.

Nenhum valor do Portal fica no componente.

---

## 8. Shared asset slots

Slots principais:

~~~
hero?
supporting_image?
brand_override?
~~~

Regras:

- hero pode ser fotografia, capa de livro, documento ou imagem principal;
- supporting_image fica opcional;
- logo deve preferir Identity;
- override de marca é exceção explícita.

---

# VARIANT 1 — COVER

## 9. Objetivo da cover

Abrir uma peça editorial.

Precisa responder visualmente:

- sobre o que é esta peça?
- qual objeto/pessoa/tema central?
- por que vale continuar?
- quem publica?

Pack B slide 1 é referência visual, não layout fixo.

---

## 10. Cover content slots

Proposta V0:

~~~
eyebrow?
title
subtitle?
source_line?
detail_note?
~~~

### eyebrow

Exemplo de função: Memória viva • Livros.

Máximo inicial recomendado: 48 chars.

### title

Campo principal.

Máximo inicial recomendado: 120 chars.

Não significa que 120 caracteres sempre cabem.

Template validation pode emitir warning antes.

### subtitle

Texto de apoio.

Máximo inicial recomendado: 220 chars.

### source_line

Exemplo funcional: Publicado originalmente em 1983.

Não é necessariamente fonte bibliográfica completa.

### detail_note

Pequeno bloco auxiliar.

Exemplo funcional: Edição apresentada: ...

Pode ser omitido.

---

## 11. Cover asset slots

Obrigatório no V0:

~~~
hero
~~~

Opcional:

~~~
supporting_texture
~~~

Hero pode ser:

- capa de livro;
- fotografia;
- documento;
- pessoa;
- objeto editorial.

---

## 12. Cover layout zones

Em 1080x1350:

~~~
┌────────────────────────────────┐
│ sequence marker                │
│ eyebrow                        │
│                                │
│ title block        hero        │
│ title block        hero        │
│                                │
│ subtitle           hero        │
│ source                         │
│                                │
│      ambient / collage         │
│                                │
│ brand              detail      │
└────────────────────────────────┘
~~~

A geometria real não deve ser uma grid rígida idêntica a toda peça.

O template mantém zonas e constraints.

O style pode variar rotação, overlap e ornamentação dentro de limites.

---

## 13. Cover safe areas

Valores de spike:

~~~
left/right: 56–72 px
top: 56–72 px
bottom: 64–88 px
~~~

A colagem pode visualmente invadir margens.

Conteúdo legível não deve invadir safe area.

---

## 14. Cover title treatment

Pack B sugere uma estratégia forte:

- parte do headline sobre papel rasgado;
- highlight sobre faixa secundária;
- serif display;
- contraste alto;
- hierarquia modular.

Não codificar quebra de linha específica do Portal.

O template pode oferecer internamente um tratamento de headline do tipo stacked-paper.

No V0 ele pode ser parte fixa da variant cover.

---

## 15. Cover hero behavior

Hero:

- possui leve rotação permitida;
- pode ter border/material frame;
- pode receber tape/paper backing;
- respeita focal point;
- pode sobrepor outros layers.

Faixa inicial de rotação:

~~~
-4deg .. +4deg
~~~

Mas a rotação final deve ser determinística.

Nunca randomizar em render final sem seed persistido.

---

## 16. Cover detail card

detail_note pode aparecer como:

- papel rasgado;
- nota colada;
- pequeno metadata card.

Não mostrar bloco vazio quando ausente.

---

## 17. Cover brand layer

A marca deve entrar como identidade, não conteúdo.

Preferência:

~~~
brand.logo
brand.wordmark
~~~

Quando a Identity possuir apenas logo, o template pode renderizar apenas logo.

Quando possuir wordmark, pode utilizar assinatura expandida.

Brand placement pertence à variant.

---

# VARIANT 2 — INFO

## 18. Objetivo da info

Explicar uma informação editorial com estrutura clara e um ou mais destaques.

Pack B slide 2 é a referência inicial.

A variant info não é uma cópia de “duas edições”.

Ela deve servir para:

- comparação;
- dois marcos;
- dois dados;
- duas versões;
- explicação + cards;
- contexto + fatos.

---

## 19. Info content slots

Proposta:

~~~
title
intro?
body_blocks[]
fact_cards[]
source_line?
annotation?
~~~

---

## 20. Body blocks

No V0:

~~~
body_blocks:
  paragraph[]
~~~

Evitar Rich Text arbitrário no primeiro spike.

Depois pode evoluir.

---

## 21. Fact cards

Contrato conceitual:

~~~
fact_cards:
  - primary
    secondary?
    tertiary?
  - primary
    secondary?
    tertiary?
~~~

Exemplo funcional:

~~~
primary: 1983
secondary: ed. Brasiliense
tertiary: nº 108
~~~

Limite V0:

~~~
1..2 fact_cards
~~~

Se precisarmos de 3+ cards, isso provavelmente indica outra variant.

---

## 22. Info optional annotation

annotation pode ser uma frase curta periférica.

Ela não deve carregar informação essencial.

Se a annotation não aparecer, a peça continua semanticamente completa.

---

## 23. Info asset behavior

A variant info não precisa de hero.

Pode opcionalmente usar supporting_image.

Mas o spike inicial pode validar a variant apenas com:

- text;
- fact cards;
- decoration;
- brand.

Isso é útil para provar que o template não depende de uma imagem hero.

---

## 24. Info layout zones

Em 1080x1350:

~~~
┌────────────────────────────────┐
│ marker                 brand   │
│                                │
│ headline                       │
│                                │
│ body                fact card  │
│ body                fact card  │
│                                │
│ supporting decoration          │
│ annotation                     │
└────────────────────────────────┘
~~~

A composição pode ser assimétrica.

A leitura deve continuar previsível.

---

# STYLE DIRECTION — ORGANIC COLLAGE

## 25. Objetivo

Dar materialidade editorial sem transformar tudo em uma imagem sintética única.

Elementos podem ser compostos deterministicamente como layers reais.

---

## 26. Surface system

Surfaces sugeridas:

~~~
dark-paper
light-paper
green-paper
kraft-paper
archival-paper
~~~

Project Identity fornece palette.

Style implementation resolve texturas e tonalidades.

---

## 27. Decorative primitives

Primitives iniciais:

~~~
torn_paper
tape
pin
botanical_fragment
handwritten_note
celestial_mark
network_line
archival_fragment
~~~

Não usar todas em toda peça.

---

## 28. Decoration density

Direção:

~~~
low
medium
high
~~~

Para o V0: medium.

Regra:

> decoração nunca pode competir com a informação principal.

---

## 29. Deterministic decoration plan

Não usar Math.random() para compor o resultado final.

Para o spike, um plano fixo e determinístico por variant é suficiente.

Depois podem existir:

- pequenas alternâncias por style version;
- seed persistido;
- escolha explícita no Authoring State.

---

## 30. Layer responsibilities

### SurfaceLayer
Background, paper base e subtle texture.

### AmbientDecorationLayer
Folhas, estrelas, fragmentos, redes e detalhes periféricos.

### ContentLayer
Eyebrow, title, subtitle, body e source.

### ArtifactLayer
Hero, document, cards e supporting image.

### AnnotationLayer
Notas manuscritas e micro copy não essencial.

### BrandLayer
Logo, wordmark e project signature.

---

# PROJECT IDENTITY BOUNDARY

## 31. O que vem da Identity

Preferencialmente:

~~~
typography.display
typography.body
colors.background
colors.foreground
colors.accent
brand.logo
brand.wordmark
brand.mark
~~~

Também pode futuramente trazer decorative preferences, surface preferences e image treatment.

Não é necessário expandir o schema de Project Identity para o spike.

Fixtures podem preencher esses valores.

---

## 32. O que NÃO vem da Identity

Não colocar na Project Identity:

- coordenada de um papel;
- rotação do hero;
- posição da fita;
- tamanho exato do título;
- layout da cover;
- número de fact cards;
- timing da animação.

Isso pertence ao template, variant ou content.

---

# TYPOGRAPHY

## 33. Roles

Roles iniciais:

~~~
display
body
label
annotation
metadata
~~~

A Identity fornece família/peso.

O template fornece sizing/layout.

---

## 34. Cover typography

Faixas de spike:

~~~
eyebrow: 22–28 px
title: 68–86 px
subtitle: 30–38 px
source: 20–24 px
detail: 20–26 px
~~~

O sizing final deve ser calibrado no render real.

---

## 35. Info typography

Faixas:

~~~
title: 64–80 px
body: 30–38 px
fact primary: 64–84 px
fact secondary: 26–34 px
annotation: 20–28 px
~~~

---

# MOTION

## 36. Motion philosophy

Organic collage não deve virar motion caótico.

Direção:

- papel entra como layer;
- hero pode usar subtle push/parallax;
- text reveal é discreto;
- micro-rotation pode existir;
- elementos decorativos permanecem estáveis ou quase estáveis.

---

## 37. Cover motion V0

Preset composition conceitual:

~~~
scene_motion: collage_reveal
~~~

Pode internamente combinar:

~~~
background: none
headline-paper: rise/fade
hero: slow_push
detail-card: soft_slide
brand: fade
~~~

Não adicionar collage_reveal ao contrato global ainda.

Primeiro provar como implementação da variant.

---

## 38. Info motion V0

Em vídeo:

~~~
title: reveal
body: staggered fade
fact_card_1: soft slide
fact_card_2: soft slide
~~~

Sem depender de uma timeline manual para cada subelemento.

O template versionado conhece seu micro-timing.

---

# AUTHORING

## 39. Cover authoring controls

UI mínima:

~~~
Eyebrow
Title
Subtitle
Source
Detail note
Hero asset
Focal point
Sequence index/total
~~~

Project Identity vem do Project.

O usuário não seleciona posição de cada papel no V0.

---

## 40. Info authoring controls

UI mínima:

~~~
Title
Intro
Body paragraph 1
Body paragraph 2
Fact card 1
Fact card 2
Annotation
Sequence index/total
~~~

Fact card fields:

~~~
Primary
Secondary
Tertiary
~~~

---

## 41. Direct manipulation

V0:

- hero focal point;
- hero replace;
- text fields via inspector.

Depois:

- hero position constrained;
- paper rotation constrained;
- card reorder;
- inline text edit.

Não oferecer freeform drag de todas as layers no primeiro ciclo.

---

# SCHEMA DIRECTION

## 42. Cover content schema concept

~~~
DocumentaryCoverContent
  eyebrow?
  title
  subtitle?
  source_line?
  detail_note?
~~~

---

## 43. Info content schema concept

~~~
DocumentaryInfoContent
  title
  intro?
  body_blocks[1..2]
  fact_cards[1..2]
  source_line?
  annotation?
~~~

---

## 44. Variant-specific validation

O Registry resolve variant e valida o content correspondente.

Não criar um único schema gigante com dezenas de opcionais.

Preferir:

~~~
cover → DocumentaryCoverContentSchema
info  → DocumentaryInfoContentSchema
~~~

Isso evita flags como showFactCards, showHero, showAnnotation e showDetail.

---

# IMPLEMENTATION BOUNDARY

## 45. Suggested component tree

Conceitualmente:

~~~
DocumentaryCard
  resolveVariant()
    CoverVariant
    InfoVariant

shared/
  Surface
  SequenceMarker
  BrandSignature
  TornPaper
  Tape
  Pin
  HandwrittenNote
  BotanicalFragment
  ArtifactFrame
~~~

O path real deve seguir a auditoria do repo.

---

## 46. Reusable primitives

O spike deve tentar identificar primitives reutilizáveis, mas não extrair cedo demais.

Regra:

> duas ocorrências reais antes de abstrair, salvo primitive óbvia de infraestrutura.

Exemplos prováveis:

- TornPaper;
- Tape;
- SequenceMarker;
- BrandSignature.

---

# TEST FIXTURES

## 47. Fixture A — Portal cover

Base visual: Pack B slide 1.

Objetivo:

- provar cover;
- hero;
- brand;
- collage;
- sequence marker.

---

## 48. Fixture B — Portal info

Base visual: Pack B slide 2.

Objetivo:

- provar info;
- paragraphs;
- two fact cards;
- annotation;
- brand;
- no hero dependency.

---

## 49. Fixture C — Neutral second project

Obrigatório antes de fechar o spike.

Usar:

- outra palette;
- outra display font;
- outro logo;
- outro conteúdo;
- outro hero ou sem hero.

Objetivo:

> provar que o resultado continua editorial-documentary, mas deixa de parecer Portal.

---

# ACCEPTANCE

## 50. Cover gate

Passa se:

- title é editável;
- hero é substituível;
- sequence marker deriva de context;
- brand deriva da Identity;
- text não está rasterizado;
- layout não depende de Terra Una ou livro específico;
- PNG 1080x1350 funciona;
- versão 1080x1920 mantém DNA;
- video motion funciona sem mudar o content schema.

---

## 51. Info gate

Passa se:

- 1 ou 2 fact cards funcionam;
- body blocks são editáveis;
- annotation pode sumir;
- brand deriva da Identity;
- não depende de hero;
- overflow produz warning;
- design continua reconhecível como mesma family.

---

## 52. Family gate

A família passa se cover + info compartilham:

- typography roles;
- surface language;
- brand behavior;
- sequence marker logic;
- decorative primitives;
- identity tokens;

mas possuem layouts realmente distintos.

---

# DEFERRED DECISIONS

## 53. Não fechar ainda

Deixar para depois:

- StylePack como entidade/schema próprio;
- editor de collage;
- random layout generator;
- marketplace;
- user-created templates;
- arbitrary freeform layers;
- variants map/icon-grid/network/quote;
- import dos 10 slides inteiros;
- persistence de authoring state;
- font picker completo.

---

# DECISIONS V0

## 54. Fechadas nesta anatomia

1. Continuar com editorial.documentary-card.
2. Pack B é a principal referência visual do primeiro spike.
3. Primeiras variants: cover e info.
4. Pack B inspira organic-collage, mas não cria dependência do Portal.
5. Pagination vira SequenceMarker derivado do contexto.
6. Variant-specific content schemas são preferidos a um schema gigante.
7. Cover exige hero; info não.
8. Project Identity fornece marca, palette e typography.
9. Layout material/colagem pertence ao template/style direction.
10. Decoration é determinística.
11. Authoring UI não expõe JSON.
12. Freeform drag não entra no V0.
13. Segundo Project é obrigatório para provar neutralidade.
14. StylePack formal será decidido somente quando houver um segundo style implementado.

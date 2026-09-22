# Editorial Documentary Card — Canonical Fixtures V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Template family:** editorial.documentary-card
**Variants:** cover, info
**Style direction:** organic-collage
**Visual references:** Pack B — slide 1 dark / slide 2 light
**Objetivo:** transformar duas referências reais em fixtures canônicos de implementação


---


## 1. Princípio


Os fixtures deste documento não são screenshots para serem reproduzidos pixel a pixel.


Eles especificam:


- conteúdo;
- assets;
- artifact roles;
- layers;
- z-order;
- density;
- artifact plan;
- invariantes;
- variáveis;
- comportamento still;
- comportamento em vídeo.


A implementação deve preservar a lógica visual sem codificar o Portal Comunidades Alternativas como regra do produto.


---


## 2. Regra-mãe


> Organicidade visual não significa aleatoriedade estrutural.


A composição pode parecer espontânea.


Por baixo, ela deve ser:


- determinística;
- hierárquica;
- legível;
- reproduzível;
- validável;
- consistente entre preview e render final.


---


## 3. CollageField


Durante o V0, chamaremos de CollageField a região visual que funciona como “fundo” da peça.


Ela não precisa ser um único background achatado.


Conceitualmente:


~~~
CollageField
├── base surface
├── paper planes
├── torn fragments
├── tapes / pins
├── botanical fragments
├── archival fragments
├── handwritten annotation
├── celestial/network decoration
└── optional environmental image
~~~


Alguns elementos do CollageField podem invadir camadas superiores.


Mas o CollageField nunca deve destruir a hierarquia do conteúdo.


---


## 4. Collage grammar V0


### 4.1 Sobreposição


Permitida.


Nunca sobrepor decoração ao corpo principal de leitura de forma que reduza legibilidade.


### 4.2 Rotação


Permitida para:


- hero artifact;
- fact cards;
- paper fragments;
- supporting artifacts.


Evitar rotação nos blocos principais de texto.


Faixa inicial:


~~~
-4deg .. +4deg
~~~


### 4.3 Paper planes


Por composição:


~~~
2–4 planos relevantes
~~~


Não contar pequenas texturas periféricas como plano principal.


### 4.4 Tape / pins


Por composição:


~~~
1–3 elementos
~~~


Devem parecer estruturalmente justificados.


### 4.5 Handwritten annotations


Por composição:


~~~
0–2
~~~


Sempre secundárias.


Nunca carregam informação editorial indispensável.


### 4.6 Torn edges


Usar seletivamente.


Não aplicar borda rasgada a todos os elementos.


### 4.7 Textura


Presente, porém subordinada à leitura.


### 4.8 Elemento dominante


Cada peça deve possuir um único foco visual dominante.


### 4.9 Espaço negativo


Alguma região deve respirar.


Não preencher todo espaço disponível com fragmentos.


### 4.10 Níveis simultâneos


Evitar mais de três níveis visuais competindo pela atenção ao mesmo tempo.


---


## 5. Density


Parâmetro discreto sugerido:


~~~
quiet
balanced
dense
~~~


Para os fixtures canônicos do Pack B:


~~~
density: balanced
~~~


Interpretação:


### quiet


- menos fragments;
- mais área livre;
- menos annotations;
- tape/pin mínimos.


### balanced


- colagem evidente;
- informação continua dominante;
- decoration suficiente para materialidade.


### dense


- mais artifacts;
- mais overlap;
- mais fragments;
- ainda respeita hierarquia e leitura.


No V0, density pode permanecer dentro do contexto do template sem virar contrato global definitivo.


---


## 6. Artifact roles


Todo artifact relevante deve ter role semântica.


Roles iniciais:


~~~
hero
evidence
context
decoration
annotation
brand
~~~


### hero


Elemento visual principal.


Pode ser:


- fotografia;
- capa;
- objeto;
- documento.


### evidence


Asset documental/proveniente.


Regras:


- deve apontar para asset real;
- não deve ser sintetizado como pseudo-documento;
- provenance deve ser preservável.


### context


Elemento que ajuda a interpretar o conteúdo.


Pode ser:


- card de data;
- mapa;
- etiqueta;
- bloco contextual.


Pode ser composto pelo renderer.


### decoration


Elemento ornamental.


Pode ser:


- papel;
- fita;
- folha;
- textura;
- estrela;
- rede;
- rabisco;
- SVG.


### annotation


Microtexto ou gesto gráfico secundário.


Nunca carrega informação essencial.


### brand


Logo, mark, wordmark ou assinatura do Project.


---


## 7. Evidence versus decoration


Regra editorial importante:


> um elemento que parece documento não deve ser tratado como evidence apenas por aparência.


Evidence exige provenance.


Decoration pode simular materialidade de arquivo, mas não deve fingir ser uma fonte histórica real.


Esta distinção é obrigatória em qualquer fluxo documental.


---


# FIXTURE A — COVER DARK


## 8. Identificação


~~~
fixture_id:
fixture:documentary-card:cover-dark:01


template:
editorial.documentary-card@0.1.0


variant:
cover


style_direction:
organic-collage


density:
balanced


artifact_plan:
cover-collage-01
~~~


Referência visual:


Pack B — slide 1.


---


## 9. Conteúdo canônico


~~~
sequence:
  index: 1
  total: 10


eyebrow:
MEMÓRIA VIVA • LIVROS


title:
O QUE SÃO COMUNIDADES ALTERNATIVAS?


subtitle:
Uma pergunta lançada num país em transição, enquanto outras formas de viver tentavam ganhar mais espaço.


source_line:
Publicado originalmente em 1983.


detail_note:
Edição apresentada:
Nova Cultural / Brasiliense, 1985.
Coleção Primeiros Passos, nº 58.
~~~


Observação:


O conteúdo é canônico apenas para este fixture.


O componente não deve depender desses textos.


---


## 10. Assets canônicos


### hero


~~~
role: evidence
type: image/library asset
subject: capa apresentada do livro
provenance: obrigatória
fit: contain
~~~


### brand


~~~
role: brand
source: Project Identity
expected:
  logo
  wordmark
~~~


### environmental image


~~~
role: decoration
subject: paisagem montanhosa / lua
optional: true
~~~


### botanical fragments


~~~
role: decoration
type: SVG/PNG
quantity: 1–3
~~~


### paper textures


~~~
role: decoration
type: raster/SVG masks
quantity: 2–4 relevant planes
~~~


### tape


~~~
role: decoration
quantity: 1–2
~~~


### handwritten notes


~~~
role: annotation
quantity: 0–2
~~~


### celestial/network elements


~~~
role: decoration
quantity: low
~~~


---


## 11. Fixture A layer plan


Z-order conceitual:


~~~
z00  base dark surface
z05  subtle texture
z10  environmental landscape
z15  celestial/network marks
z20  background paper fragments
z25  title paper plane
z30  content text
z35  hero backing paper
z40  hero evidence
z45  tape / botanical overlap
z50  detail note card
z55  annotations
z60  brand
z65  foreground decorative fragments
~~~


O número exato não precisa virar z-index literal igual.


A ordem relativa é o que importa.


---


## 12. Fixture A element dominance


Elemento dominante:


~~~
hero evidence + headline cluster
~~~


A composição deve possuir somente um foco principal.


A marca não deve competir com o título.


Annotations não devem competir com source/detail.


---


## 13. Fixture A invariantes


Nunca pode variar:


- title permanece elemento textual real;
- hero evidence preserva provenance;
- sequence data é semântica;
- brand vem da Identity;
- informação essencial não aparece apenas em handwriting;
- source_line permanece legível;
- composição possui espaço negativo;
- decoration não cobre headline/body;
- preview e render final usam a mesma árvore visual.


---


## 14. Fixture A variáveis permitidas


Podem variar dentro de constraints:


- rotação do hero;
- shape do paper plane;
- posição da tape;
- escolha entre 1 ou 2 botanical fragments;
- posição periférica de annotation;
- intensidade de textura;
- presença do environmental image;
- surface dentro da palette do Project.


No V0 essas variações devem ser determinísticas pelo artifactPlan.


---


## 15. Fixture A artifactPlan


~~~
cover-collage-01
~~~


Significa semanticamente:


- headline sobre paper plane;
- hero evidence à direita;
- hero com backing material;
- detail note em pequeno paper card;
- brand na faixa inferior;
- botanical fragment próximo do hero/brand;
- annotation periférica;
- decoração celestial discreta;
- espaço negativo preservado.


Não significa coordenadas expostas ao usuário.


---


## 16. Fixture A still behavior


- title e hero aparecem em estado final;
- tape/papers estáticos;
- sem motion artificial;
- crop/focal point aplicado;
- annotations já posicionadas;
- output inicial: PNG 1080x1350.


---


## 17. Fixture A video behavior


Duração de teste:


~~~
180 frames
30 fps
6 seconds
~~~


Micro-timing sugerido:


~~~
0–180   base surface + collage field
0–180   hero slow_push
8–24    eyebrow fade/reveal
12–36   headline paper + title reveal
20–44   subtitle fade
28–52   source fade
36–60   detail note soft slide
44–68   brand fade
~~~


Annotations e decoration permanecem quase estáticos.


Motion nunca pode transformar a colagem em motion caótico.


---


## 18. Fixture A pseudo-manifest


~~~json
{
  "template": {
    "id": "editorial.documentary-card",
    "version": "0.1.0",
    "variant": "cover",
    "scope": "system"
  },
  "sequence": {
    "index": 1,
    "total": 10
  },
  "content": {
    "eyebrow": "MEMÓRIA VIVA • LIVROS",
    "title": "O QUE SÃO COMUNIDADES ALTERNATIVAS?",
    "subtitle": "Uma pergunta lançada num país em transição, enquanto outras formas de viver tentavam ganhar mais espaço.",
    "source_line": "Publicado originalmente em 1983.",
    "detail_note": "Edição apresentada: Nova Cultural / Brasiliense, 1985. Coleção Primeiros Passos, nº 58."
  },
  "composition": {
    "density": "balanced",
    "artifact_plan": "cover-collage-01"
  },
  "assets": {
    "hero": {
      "role": "evidence",
      "ref": "fixture:asset:book-cover",
      "fit": "contain",
      "focal_point": {
        "x": 0.53,
        "y": 0.42
      }
    }
  }
}
~~~


Este pseudo-manifest ainda não altera o schema oficial.


Serve para orientar implementação e futura evolução.


---


# FIXTURE B — INFO LIGHT


## 19. Identificação


~~~
fixture_id:
fixture:documentary-card:info-light:01


template:
editorial.documentary-card@0.1.0


variant:
info


style_direction:
organic-collage


density:
balanced


artifact_plan:
info-collage-01
~~~


Referência visual:


Pack B — slide 2.


---


## 20. Conteúdo canônico


~~~
sequence:
  index: 2
  total: 10


title:
UMA PERGUNTA, DUAS EDIÇÕES


body_block_1:
Há registro de uma edição Brasiliense de 1983, na Coleção Primeiros Passos nº 108.


body_block_2:
O exemplar apresentado aqui é a edição Nova Cultural / Brasiliense, de 1985, identificada como nº 58 da coleção.


fact_card_1:
  primary: 1983
  secondary: ed. Brasiliense
  tertiary: nº 108


fact_card_2:
  primary: 1985
  secondary: ed. Nova Cultural / Brasiliense
  tertiary: nº 58
~~~


Annotations observadas no Pack B são decorativas/secundárias e não entram como conteúdo obrigatório.


---


## 21. Fixture B assets


### brand mark


~~~
role: brand
source: Project Identity
~~~


### botanical fragments


~~~
role: decoration
quantity: 1–3
~~~


### paper planes


~~~
role: decoration
quantity: 2–4
~~~


### tape / pin


~~~
role: decoration
quantity: 1–3
~~~


### book stack illustration


~~~
role: decoration/context
optional: true
~~~


### handwritten annotations


~~~
role: annotation
quantity: 0–2
~~~


Nenhum hero evidence é obrigatório.


---


## 22. Fixture B layer plan


~~~
z00  light paper surface
z05  subtle paper texture
z10  background fragments
z15  botanical fragments
z20  title paper plane
z25  title
z30  body content
z35  fact card backing
z40  fact card 1
z42  fact card 2
z45  tape / pin
z50  annotations
z55  optional supporting illustration
z60  brand mark
z65  foreground fragments
~~~


---


## 23. Fixture B element dominance


Elemento dominante:


~~~
headline + fact card pair
~~~


Body copy fica em segundo nível.


Decoration fica em terceiro.


---


## 24. Fixture B invariantes


Nunca pode variar:


- headline continua legível;
- body blocks permanecem texto real;
- fact card values permanecem textuais;
- sequence data vem de context;
- brand vem da Identity;
- annotations não carregam fatos essenciais;
- 1 ou 2 fact cards funcionam;
- ausência de illustration não quebra layout;
- nenhum pseudo-documento decorativo é tratado como evidence.


---


## 25. Fixture B variáveis permitidas


- posição relativa dos two fact cards;
- rotação leve dos cards;
- presença/ausência de botanical fragment;
- presença/ausência de supporting illustration;
- 0–2 annotations;
- tape versus pin;
- paper texture;
- tonalidade dentro da palette.


Tudo via artifactPlan determinístico.


---


## 26. Fixture B artifactPlan


~~~
info-collage-01
~~~


Significa:


- headline sobre stacked paper;
- body à esquerda;
- fact cards à direita;
- cards com pequena diferença de rotação;
- decoration nas bordas;
- brand discreto;
- annotation periférica;
- área central de leitura preservada.


---


## 27. Fixture B still behavior


- todos os texts em estado final;
- cards estáticos;
- sem pseudo-animation;
- output inicial: PNG 1080x1350.


---


## 28. Fixture B video behavior


Duração sugerida:


~~~
180 frames
30 fps
6 seconds
~~~


Micro-timing:


~~~
0–180   surface + collage field
8–28    title reveal
18–42   body block 1 fade
28–52   body block 2 fade
36–58   fact card 1 soft slide
46–70   fact card 2 soft slide
54–76   brand fade
~~~


Cards podem receber micro-parallax discreto.


Nunca usar bounce exagerado.


---


## 29. Fixture B pseudo-manifest


~~~json
{
  "template": {
    "id": "editorial.documentary-card",
    "version": "0.1.0",
    "variant": "info",
    "scope": "system"
  },
  "sequence": {
    "index": 2,
    "total": 10
  },
  "content": {
    "title": "UMA PERGUNTA, DUAS EDIÇÕES",
    "body_blocks": [
      "Há registro de uma edição Brasiliense de 1983, na Coleção Primeiros Passos nº 108.",
      "O exemplar apresentado aqui é a edição Nova Cultural / Brasiliense, de 1985, identificada como nº 58 da coleção."
    ],
    "fact_cards": [
      {
        "primary": "1983",
        "secondary": "ed. Brasiliense",
        "tertiary": "nº 108"
      },
      {
        "primary": "1985",
        "secondary": "ed. Nova Cultural / Brasiliense",
        "tertiary": "nº 58"
      }
    ]
  },
  "composition": {
    "density": "balanced",
    "artifact_plan": "info-collage-01"
  }
}
~~~


---


# SHARED IMPLEMENTATION RULES


## 30. Grid invisível


Pack B pode parecer espontâneo.


Por baixo deve existir uma grade invisível.


A grade controla:


- safe area;
- alignment anchors;
- text width;
- artifact zones;
- brand zone;
- negative space.


Papers podem ultrapassar visualmente a grade.


Texto essencial não.


---


## 31. Pack A contribution


O Pack A continua sendo referência estrutural para:


- legibilidade;
- ritmo;
- hierarquia;
- constância;
- volume informacional;
- relação entre dez lâminas.


Pack B fornece:


- materialidade;
- overlap;
- collage language;
- imperfeição controlada.


Síntese desejada:


> estrutura editorial do Pack A + linguagem material do Pack B.


---


## 32. Raster versus vector versus text


### Text real


Usar para:


- title;
- body;
- facts;
- source;
- pagination;
- annotations quando digitadas.


### SVG/vector


Preferir para:


- line icons;
- network/celestial marks;
- simple botanical linework;
- brand mark quando disponível;
- simple ornamental geometry.


### Raster


Usar para:


- photographs;
- scanned documents;
- paper textures;
- complex torn edges;
- natural botanical cutouts;
- archival fragments.


---


## 33. Generated assets


Se um decorative asset for sintético, registrar origem quando relevante.


Evidence não deve ser gerado apenas para parecer histórico.


O renderer não deve confundir synthetic decoration com source material.


---


## 34. What can vary automatically


Pode variar por artifactPlan/style version:


- torn edge shape;
- decoration choice;
- small rotation;
- tape selection;
- peripheral annotation placement;
- paper texture choice.


Não pode variar automaticamente:


- conteúdo;
- evidence;
- provenance;
- sequence data;
- brand identity;
- semantic role;
- hierarchy.


---


## 35. Fixture neutrality test


Depois de implementar A e B, substituir:


- Project Identity;
- palette;
- typography;
- brand;
- text;
- hero/content.


O resultado deve:


- continuar pertencendo à família editorial.documentary-card;
- deixar de parecer Portal;
- preservar cover/info semantics;
- manter legibilidade.


---


## 36. Acceptance summary


O conjunto de fixtures V0 passa se:


1. cover e info usam a mesma family;
2. os dois possuem layouts distintos;
3. density funciona como regra discreta;
4. artifactPlan produz composição determinística;
5. evidence e decoration não se confundem;
6. pagination vem de sequence context;
7. texts continuam editáveis;
8. brand vem da Identity;
9. CollageField não precisa ser raster único;
10. preview e final render permanecem visualmente equivalentes;
11. Pack B parece orgânico sem depender de aleatoriedade;
12. Pack A continua informando estrutura e legibilidade.


---


## 37. Decisões V0 fechadas


1. Cover dark e info light viram fixtures canônicos.
2. CollageField é conceito visual útil, não necessariamente entidade de domínio.
3. Density V0: quiet, balanced, dense.
4. Fixtures usam balanced.
5. Artifact roles entram desde o início.
6. Evidence exige provenance.
7. Decoration pode ser sintética.
8. ArtifactPlan é determinístico.
9. Cover usa cover-collage-01.
10. Info usa info-collage-01.
11. Organicidade não depende de random.
12. Pack A e Pack B são complementares.
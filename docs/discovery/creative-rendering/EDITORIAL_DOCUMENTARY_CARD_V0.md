# Editorial Documentary Card V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Template:** editorial.documentary-card
**Versão inicial:** 0.1.0
**Escopo:** primeiro template visual genérico compartilhado entre still e vídeo


---


## 1. Objetivo


Definir o primeiro template real da Creative Rendering Layer.


O objetivo não é criar um design específico para o Portal Comunidades Alternativas. O Portal será apenas a primeira fixture de validação.


O template deve ser reutilizável por qualquer Project que precise de uma peça editorial/documental baseada em fotografia, título e informações de contexto.


## 2. Princípio de autoria


O manifest não é a interface de edição.


Ele é o estado serializado e validável usado para preview, persistência e render.


Direção:


~~~
Front-end authoring UI
        ↓
Authoring State
        ↓
validation / normalization
        ↓
StaticRenderManifest ou TimelineManifest
        ↓
preview / render
~~~


O usuário não deve editar JSON diretamente.


## 3. Experiência de autoria desejada


O primeiro V0 não precisa construir um Canva completo.


Uma interface suficiente pode possuir:


- preview central;
- campo de título;
- campo de subtítulo;
- campo de eyebrow;
- linha de fonte/crédito;
- seleção do hero asset;
- seletor de variant;
- seletor de formato/canvas;
- seletor de motion quando em vídeo;
- painel de Project Identity;
- botão de render/export.


Evoluções possíveis:


- arrastar uma imagem da Library para o slot hero;
- substituir imagem diretamente no canvas;
- mover focal point;
- editar texto inline;
- selecionar elementos no canvas;
- inspector contextual;
- undo/redo;
- duplicação de slide/cena;
- reorder de slides/cenas.


Essas evoluções não devem alterar o contrato de render sem necessidade.


## 4. Estado de autoria versus manifest


Pode existir futuramente um AuthoringState mais rico do que o manifest.


Exemplo conceitual:


~~~
AuthoringState
  selectedElement
  activePanel
  zoom
  temporaryDragState
  unsavedText
  cropInteraction
  history
  ↓
serialize()
  ↓
StaticRenderManifest
~~~


Estados efêmeros de UI não pertencem ao manifest.


Exemplos que não devem ser persistidos no contrato de render:


- elemento selecionado;
- cursor;
- hover;
- painel aberto;
- posição de scroll;
- estado de drag temporário.


## 5. Conteúdo V0


Contrato inicial:


~~~
eyebrow?
title
subtitle?
source_line?
footer?
~~~


Campos são dados editáveis.


Valores nunca ficam hardcoded no componente.


Exemplo:


~~~
title = Terra Una
~~~


é apenas uma fixture.


## 6. Assets V0


Slot obrigatório:


~~~
hero
~~~


Slot opcional:


~~~
logo
~~~


Preferência:


- hero vem do manifest;
- logo vem da Project Identity quando disponível;
- override explícito de logo pode ser permitido futuramente.


## 7. Hierarquia visual


A hierarquia desejada para a variant cover é:


1. fotografia;
2. título;
3. eyebrow;
4. subtítulo;
5. fonte/crédito;
6. assinatura visual.


A fotografia deve permanecer dominante.


O design não deve transformar conteúdo documental em peça promocional genérica.


## 8. Layout base


### 8.1 Regra geral


O template usa composição full-canvas.


Camadas conceituais:


~~~
Canvas
├── Hero Image
├── Contrast Overlay
├── Editorial Content Block
├── Source / Credit
└── Brand Signature
~~~


### 8.2 Canvas 1080x1350


Valores iniciais de spike, não regra global:


~~~
safe left/right: 72 px
safe top: 72 px
safe bottom: 84 px


text block max width: ~880 px
title max lines: 3
subtitle max lines: 2
~~~


A fotografia pode ocupar todo o canvas.


O conteúdo textual principal fica preferencialmente no terço inferior.


### 8.3 Canvas 1080x1920


Valores iniciais de spike:


~~~
safe left/right: 72 px
safe top: 96 px
safe bottom: 120 px


text block max width: ~900 px
title max lines: 4
subtitle max lines: 3
~~~


O layout vertical não deve ser simplesmente a versão 4:5 esticada.


## 9. Tipografia


A Project Identity compilada fornece famílias, pesos e preferências semânticas.


O template controla escala e hierarquia.


Exemplo inicial:


### 1080x1350


~~~
eyebrow: 28-32 px
title: 72-82 px
subtitle: 34-40 px
source: 22-26 px
footer: 20-24 px
~~~


### 1080x1920


~~~
eyebrow: 30-34 px
title: 80-92 px
subtitle: 38-44 px
source: 24-28 px
footer: 22-26 px
~~~


Essas faixas serão calibradas visualmente no spike.


O manifest não guarda esses tamanhos.


## 10. Fontes como recurso global do Studio


Direção de produto:


~~~
Project Settings
→ Typography
→ Font Picker
→ Font Catalog Provider
→ FontRef
→ Project Identity
→ VisualTokensSnapshot
~~~


O usuário pode pesquisar e selecionar fontes sem precisar sair do Studio.


Providers futuros podem incluir:


- Google Fonts;
- fontes locais do Studio;
- fontes enviadas pelo usuário;
- fonte corporativa/privada.


O Project Identity deve guardar uma referência estável à fonte, não apenas texto informal.


Exemplo conceitual:


~~~
display_font:
  provider: google_fonts
  family: Newsreader
  version: ...
  weights: [600, 700]
~~~


Questões de licença e redistribuição precisam ser tratadas separadamente para fontes enviadas pelo usuário.


## 11. Hero image behavior


Default:


~~~
fit: cover
~~~


O template deve respeitar focal_point quando presente.


O focal point pode orientar crop e motion.


Exemplo:


~~~
focal_point = 0.50, 0.42
~~~


Em still:


- crop permanece estático.


Em video com slow_push:


- o zoom deve preservar a região de interesse;
- não aplicar pan aleatório que retire o sujeito do enquadramento.


## 12. Contrast overlay


O overlay pertence ao template.


Objetivo:


- preservar leitura;
- manter fotografia visível;
- evitar caixas opacas desnecessárias.


Primeiro experimento:


- gradient inferior;
- intensidade derivada do design do template;
- sem parâmetro livre no manifest V0.


## 13. Overflow


Política inicial:


~~~
human_review
~~~


O template pode reduzir levemente o tamanho dentro de uma faixa controlada.


Não reduzir indefinidamente.


Se não couber:


~~~
content_overflow_risk
~~~


Opções:


- editar texto;
- selecionar outra variant;
- permitir quebra adicional;
- rejeitar render final.


## 14. Variant cover


Implementar primeiro somente o que estiver realmente pronto.


Se a implementação inicial possuir apenas cover, o Registry deve anunciar apenas:


~~~
variants: [cover]
~~~


Não anunciar standard até que exista e esteja testada.


## 15. Still behavior


Em still:


- frame temporal não influencia layout;
- motion é ignorado;
- todos os elementos aparecem em estado final;
- output inicial: PNG;
- preview pode usar Thumbnail ou componente React equivalente;
- render final usa o adapter estático.


## 16. Video behavior


Em vídeo o layout-base continua o mesmo.


Motion acrescenta mudança no tempo sem alterar o conteúdo estrutural.


Preset inicial:


~~~
slow_push
~~~


Comportamento conceitual:


- hero image recebe zoom sutil;
- focal point permanece como centro visual;
- overlay acompanha a imagem;
- texto entra de forma discreta;
- assinatura não precisa animar no primeiro V0.


Segundo preset:


~~~
fade
~~~


pode controlar entrada do bloco textual.


## 17. Motion timing sugerido para spike


Cena de 6 segundos a 30 fps:


~~~
0-180 frames: hero visível
0-180 frames: slow_push contínuo
8-24 frames: eyebrow aparece
12-32 frames: title aparece
20-40 frames: subtitle aparece
28-48 frames: source aparece
~~~


Esses números pertencem à implementação versionada do template.


Não ao Timeline Manifest.


## 18. Interação no canvas


O Content Studio pode evoluir para interações diretas.


V0 recomendado:


- hero drop zone;
- selecionar/trocar asset;
- alterar focal point;
- editar texto pelo inspector;
- preview em tempo real.


Depois:


- inline text editing;
- drag de elementos;
- resize controlado;
- reposition em templates que permitam overrides.


Importante:


> direct manipulation deve respeitar as capacidades do template.


Nem todo template precisa permitir mover tudo livremente.


## 19. Authoring capabilities


Futura metadata possível:


~~~
authoring:
  editable_content:
    eyebrow
    title
    subtitle
    source_line
    footer


  editable_assets:
    hero


  direct_manipulation:
    focal_point


  locked_layout:
    true
~~~


Isso pode virar um contrato próprio depois do spike.


Não incluir no manifest principal agora.


## 20. Project neutrality


O template não contém:


- Terra Una;
- Comunidades Alternativas;
- slogan do Portal;
- logo do Portal;
- cores do Portal;
- fontes do Portal.


Tudo isso chega por content, assets ou identity tokens.


## 21. Primeiro spike visual


A fixture do Portal pode fornecer:


~~~
eyebrow: Comunidade em foco
title: Terra Una
subtitle: Memórias, práticas e caminhos de uma experiência comunitária
source_line: Portal Comunidades Alternativas
hero: documentary-photo-01
~~~


O mesmo template deve ser testado depois com um segundo Project fictício ou real.


Objetivo: provar neutralidade.


## 22. Critérios de aceite


O template V0 passa se:


- renderiza 1080x1350;
- renderiza 1080x1920;
- usa o mesmo content contract;
- usa Project Identity para typography/brand;
- hero respeita focal point;
- title longo gera warning previsível;
- ainda é reconhecivelmente o mesmo design em still e video;
- slow_push funciona sem mexer no manifest;
- nenhum código depende do Portal;
- mudanças no front-end podem atualizar o preview sem editar código.


## 23. Decisões V0


1. Manifest é estado serializado, não editor.
2. Front-end trabalha sobre Authoring State.
3. Primeiro template implementado é cover.
4. Layout permanece controlado pelo template.
5. Font families vêm da Identity; sizes vêm do template.
6. Font catalog é uma futura capacidade global.
7. Hero usa cover + focal point.
8. Motion inicial é semântico e restrito.
9. Direct manipulation será capability, não liberdade irrestrita.
10. Portal continua somente fixture.
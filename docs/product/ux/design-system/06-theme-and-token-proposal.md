# Theme and Token Proposal

Esta proposta visa criar as fundacoes de variaveis CSS (Tokens) semanticas abstraindo a paleta utilitaria em papeis do produto. Estes tokens guiarão todos os tres temas do aplicativo (`light`, `dark`, `studio`).

## 1. Tokens Semânticos

Ao invés de especificar por componente (`--button-primary`), usaremos nomes estritamente baseados na estrutura de superficie para maior flexibilidade. Os temas alteram os valores destas variaveis mantendo toda a aplicacao (html, classes Tailwind) iguais.

### Canvas e Superficies
- `canvas`: Fundo base da aplicacao inteira (Body).
- `surface`: Fundos de cards base ou shell secundarios (Nav).
- `surface-subtle`: Paineis internos embutidos (Background de modulos inativos, ou espacos negativos internos).
- `surface-elevated`: Elementos flutuantes, popovers, drawers, headers fixos.
- `surface-overlay`: Backgrounds para modais (com translucidez).
- `surface-translucent`: Modulos glass, como status pills e tabs.

### Texto
- `text-primary`: Textos vitais e de maxima leitura (Headers, conteudos core, nomes de projeto).
- `text-secondary`: Metadata utilitário, subtitulos (Descricoes).
- `text-muted`: Placeholder, sub-detalhes, elementos menores que as vezes podem desaparecer na visao periferica.
- `text-inverse`: Texto contrastante quando sobre acoes (ex: Texto branco sobre botão preto, e vice versa).

### Bordas
- `border-subtle`: Divisores finos (`hr`), bordas internas invisiveis entre cards vizinhos.
- `border-default`: O delimitador padrão para separar entidades e modais do canvas.
- `border-emphasis`: Delimitador acentuado (foco, selecao de modulos na galeria).
- `border-focus`: Acessibilidade.

### Ações e Estados
- `accent-primary`: Cores institucionais do brand, ligadas a gerar / criar / submeter.
- `accent-secondary`: Acoes neutras (cancelar, fechar, secundarios).
- `success`, `warning`, `danger`, `info`: Os 4 pilares semanticos de estado (usados em Badges e Callouts).
- `focus-ring` & `selection`.

### Atmosfera (Especialmente para o tema "Studio")
- `atmosphere-primary`: Gradiente primario de fundo.
- `atmosphere-secondary`: Pontos de realce secundário.
- `grid-color`: Cor sutil da malha geométrica.
- `glow-soft`, `glow-strong`: Controle de box-shadow e halos.

### Geometria
- `radius-control`: Elementos interativos (Inputs, Botoes).
- `radius-card`: OperationalCards e Entidades (Ex: 0.75rem ou 1rem).
- `radius-panel`: Modulos grandes de layout e modais (`30px` ou `24px` do Hermes, mas normalizado para `xl` / `2xl` do Tailwind).

### Espaçamento
- `page-padding`: Padding da shell base.
- `section-gap`: Espaço entre Headers e grids de entidades.
- `card-gap`: Gap para grids/lists.
- `content-max-width`: `4xl` padrao para listas de hubs.

## 2. Temas Propostos

Os tres temas deverão ser ativados via classes de modo (`.dark`, `.theme-studio`), e todos aplicar-se-ão de maneira holistica à mesma base de componentes.

### Light
- **Filosofia:** Clareza, bordas perceptiveis, baixa fadiga visual.
- **Caracteristicas:** Fundos esbranquiçados (`#ffffff`, `#f8f9fa`), bordas nitidas `#e2e8f0`. Hierarquia feita via sombras sutis de elevacao e cinzas textuais. Evita gradients e glows. O tema preferido para longas sessoes de edicao textual.

### Dark
- **Filosofia:** Conforto focal, distincao perceptivel entre o preto base e cinzas escuros de Cards.
- **Caracteristicas:** Evita o uso do `#000000` dominante. Usa fundos do tipo `#121212` ate `#1e1e1e`. Usa bordas claras de `opacity` 5-10% para delimitar cards. Sem atmosfera de glow. A tipografia primaria se baseia em brancos opacos para nao deslumbrar a retina (`rgba(255,255,255,0.9)`).

### Studio
- **Filosofia:** Apelo sensorial elevado, reinterpretacao do "Hermes", interface orientada para "magia" multimodal e geracao estetica, onde a aplicacao reflete a natureza criativa dos conteudos produzidos.
- **Caracteristicas:** Usa as Foundations e Components extraidas do HTML referencia.
  - Fundo base `#15151F`.
  - Bordas glass translucidas (`rgba(255,255,255, 0.1)`).
  - Background radial-gradients violetas, cyans, rosa seletivos.
  - Malha `dot-grid` e brilhos focais (`glow-soft`).
- **Limites do Studio:** Nao deve afetar legibilidade textual ou espacamentos. As listas do CA Studio permaneceram operacionais. O uso de glow será circunscrito a destaques (Açoes, Status pills) para nao sobrecarregar as paginas (evitando o estilo "dashboard gamer" nocivo). A estrutura DOM/Layout nao muda, apenas se conectam variáveis de box-shadow e backgrounds customizados as classes Tailwind.

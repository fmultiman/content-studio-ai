# DS-1D Studio Theme

## Objetivo
Implementar `studio` como a terceira expressao visual real do Design System, mantendo:

- mesmo DOM;
- mesmas anatomias;
- mesmos componentes;
- mesma responsividade;
- mesma acessibilidade;
- mesmos contratos UX-H4.

O DS-1D nao cria uma interface paralela. Ele reinterpreta a referencia Hermes para o contexto do Content Agent Studio por `theme mappings`, atmosfera, superficies, bordas, accent e efeitos seletivos.

## Motivacao
Depois do DS-1B e do DS-1C, o produto ja possuia:

- infraestrutura unica de tokens e temas;
- baseline formal de `light` e `dark`;
- separacao semantica entre tema, shell, superficies e controles.

Faltava a expressao visual do Studio para comunicar:

- creative operations;
- producao multimodal;
- inteligencia cultural;
- continuidade de projetos;
- ambiente de criacao profissional.

## Referencia Hermes
O `dashboard_ref.html` foi tratado como fonte primaria para a linguagem-base do Studio, especialmente para:

- tipografia;
- canvas azul-noturno;
- atmosfera violeta/ciano;
- shell continuo;
- paines integrados ao canvas;
- borda superior discreta;
- glass seletivo;
- microtipografia tecnica.

O DS-1D atingiu essa linguagem-base. Diferencas restantes em relacao ao Hermes ficam deferidas para refinamento posterior, nao para fechamento desta rodada.

## Arquitetura Final

### Contrato de tema
```text
theme:
light | dark | system | studio
```

### Contrato de intensidade
```text
studio_intensity:
soft | balanced | expressive
```

### Razao para nao criar tres temas separados
`Studio` continua sendo um unico tema estrutural. As intensidades modulam apenas a camada atmosferica e efeitos visuais.

Isso preserva:

- um unico mapping estrutural de tokens;
- uma unica anatomia por componente;
- uma unica fonte de verdade para o tema Studio;
- ausencia de classes paralelas como `studio-soft-theme`.

## Tipografia

### Studio
- `Inter Tight` para titulos, navegacao e conteudo;
- `JetBrains Mono` para labels, tabs e microdetalhes tecnicos.

### Light, Dark e System
- `Geist` preservado.

### Implementacao
- `app/layout.tsx` passou a expor as variaveis tipograficas no `html`;
- `app/globals.css` passou a mapear `--app-font-sans`, `--app-font-mono`, `--font-display` e `--font-technical`;
- Studio aplica as familias da referencia sem criar componentes paralelos.

## Paleta
O Studio parte dos valores extraidos da referencia Hermes:

- canvas base: `#15151F`
- text primary: `#F4F4F8`
- text secondary: `#8A8A9B`
- violet accent: `#8B5CF6`
- violet glow: `#A78BFA`
- cyan accent: `#7DD3FC`
- mint support: `#5EE2B5`
- pink support: `#F472B6`
- surface glass base: `rgba(31,31,43,0.55)`
- surface soft: `rgba(31,31,43,0.38)`

Brand e status permaneceram separados:

- violeta/ciano/mint/pink: marca e atmosfera;
- success/warning/danger/info: semantica operacional.

## Tokens e Mappings

### Mappings estruturais do Studio
O tema Studio usa a mesma taxonomia semantica do DS-1B/DS-1C:

- `canvas`
- `surface`
- `surface-subtle`
- `surface-elevated`
- `surface-overlay`
- `surface-translucent`
- `surface-interactive`
- `surface-selected`
- `text-primary`
- `text-secondary`
- `text-muted`
- `text-disabled`
- `text-link`
- `border-subtle`
- `border-default`
- `border-emphasis`
- `border-selected`
- `border-focus`
- `focus-ring`
- `success`
- `warning`
- `danger`
- `info`
- `unavailable`
- `disabled`
- `atmosphere-primary`
- `atmosphere-secondary`
- `grid-color`
- `glow-soft`
- `glow-strong`
- `elevation-low`
- `elevation-medium`
- `elevation-high`

### Camada adicional de intensidade
As intensidades modulam somente tokens atmosfericos:

- `--studio-atmosphere-opacity`
- `--studio-grid-opacity`
- `--studio-grid-size`
- `--studio-halo-primary-opacity`
- `--studio-halo-secondary-opacity`
- `--studio-halo-size`
- `--studio-halo-spread`
- `--studio-panel-gradient-opacity`
- `--studio-top-border-opacity`
- `--studio-top-border-glow`
- `--studio-shell-separation`
- `--studio-canvas-violet-opacity`
- `--studio-canvas-cyan-opacity`
- `--studio-shell-top-opacity`
- `--studio-shell-bottom-opacity`
- `--studio-shell-surface-mix`
- `--studio-panel-surface-mix`
- `--studio-panel-highlight-opacity`
- `--studio-panel-violet-opacity`
- `--studio-panel-cyan-opacity`
- `--studio-glass-opacity`
- `--studio-glass-blur`
- `--studio-accent-intensity`

## Canvas, Halos e Grid

### Canvas
- base azul-noturno/violeta profunda;
- violeta concentrado no topo/esquerda;
- ciano no lado direito/inferior;
- centro ainda profundo;
- continuidade visual entre canvas, header, sidebar e conteudo.

### Halos
- difusos, amplos e subordinados ao conteudo;
- `Soft`: contidos;
- `Balanced`: perceptiveis e localizados;
- `Expressive`: mais amplos e presentes, sem virar neon.

### Grid
O grid nao e elemento estrutural obrigatorio do Studio nesta versao.

Classificacao final:

- `Soft`: ausente ou praticamente imperceptivel;
- `Balanced`: presenca minima e discreta;
- `Expressive`: presenca tecnica maior, ainda visualmente muito sutil.

A ausencia visual forte do grid no `Balanced` nao invalida o tema. O refinamento do grid fica deferido para acabamento visual posterior, junto com controles, cards e indicadores.

## Shell
O shell estrutural foi preservado, mas sua expressao visual mudou de blocos rigidos para ambiente continuo.

Resultado:

- header e sidebar participam do mesmo campo atmosferico;
- shell usa glass seletivo e translucidez controlada;
- nao houve remocao de contraste de navegacao;
- `Light`, `Dark` e `System` nao receberam atmosfera Studio.

## Glass
Uso aprovado:

- header;
- sidebar;
- overlays;
- paines base;
- dialogs.

Uso evitado:

- inputs como glass pesado;
- listas densas;
- tabelas;
- thumbnails;
- formularios complexos com ruido visual.

## Borda Superior
Paineis base, cards e dialogs passaram a usar assinatura superior violeta/ciano:

- discreta;
- continua com o painel;
- sem glow excessivo;
- sem contextualizacao ampla por dominio nesta rodada.

## Intensidades

### Studio Soft
Congelado como:

- profundo;
- contido;
- confortavel;
- proximo da sobriedade do dark, mas reconhecivel como Studio.

Caracteristicas:

- halos suaves;
- glass minimo;
- glow praticamente ausente;
- bordas e accents contidos;
- grid ausente ou quase invisivel.

### Studio Balanced
Congelado como baseline oficial e recomendado.

Caracteristicas:

- correspondencia cromatica mais proxima do Hermes;
- shell continuo;
- paines integrados;
- grid minimo;
- halos localizados;
- glass seletivo;
- glow raro;
- melhor equilibrio entre personalidade, leitura e operacao.

### Studio Expressive
Derivado do `Balanced`, nao de um quarto tema.

Caracteristicas:

- atmosfera mais presente;
- halos maiores;
- maior presenca violeta/ciano;
- grid mais perceptivel;
- shell mais translucido;
- glass mais evidente;
- active states mais vivos;
- glow autorizado em navegacao ativa e tabs ativas.

Mantido fora do escopo:

- redesign de componentes;
- semantica nova;
- mudanca estrutural de spacing, radius ou layout.

## Persistencia

### Regras implementadas
- `theme = studio` e `studio_intensity = soft | balanced | expressive`;
- preferencia local valida vence;
- preferencia remota inicializa quando nao existe preferencia local valida;
- valor ausente cai para `balanced`;
- valor invalido cai para `balanced`;
- trocar para `dark` ou outro tema nao apaga a ultima intensidade Studio;
- retorno a `studio` restaura a ultima intensidade valida;
- `system` continua resolvendo apenas `light/dark`;
- `system` nunca resolve para `studio`.

### Implementacao
- `lib/theme.ts`
- `lib/theme-bootstrap.ts`
- `components/theme-provider.tsx`
- `components/theme-preference-bootstrap.tsx`
- `app/(dashboard)/configuracoes/page.tsx`
- `lib/types.ts`

### Migration
Foi adicionado o script:

- `scripts/030_add_studio_theme_preferences.sql`

Ele:

- adiciona `studio_intensity`;
- preenche `balanced` para registros antigos;
- define default e `not null`;
- atualiza os `check constraints` de `theme` e `studio_intensity`.

No schema ativo validado durante a rodada, leituras e gravacoes remotas com `studio_intensity` funcionaram corretamente.

## Configuracoes
`Configuracoes > Aparencia` agora oferece:

- `Claro`
- `Escuro`
- `Sistema`
- `Studio`

Quando `Studio` esta ativo, aparece o controle adicional:

- `Soft`
- `Balanced`
- `Expressive`

Cada opcao possui descricao curta, navegacao por teclado e estado selecionado acessivel.

## Acessibilidade
- contraste de texto preservado;
- foco visivel;
- navegacao do shell permaneceu legivel;
- glow nao foi usado como unico indicador;
- estados semanticos nao foram convertidos em cores de marca;
- dialogs e overlays mantiveram separacao;
- conteudo sobre gradientes e superficies translucidas permaneceu legivel.

## Responsividade

### Larguras verificadas
- `1600`
- `1280`
- `1024`
- `768`
- `390`

### Resultado
- nenhum overflow horizontal novo introduzido pelos presets Studio;
- `Expressive` reduziu blur, halo e grid em `390px`;
- os controles de intensidade permaneceram usaveis;
- o problema estrutural do shell em `390px` continua fora do escopo do DS-1D;
- Studio nao agravou esse problema.

## Smoke

### Temas validados
- `Light`
- `Dark`
- `System`
- `Studio Soft`
- `Studio Balanced`
- `Studio Expressive`

### Rotas e superficies validadas
- Dashboard
- Projetos
- Project detail
- Production
- Imagens
- Videos
- Arquivos com thumbnails
- Configuracoes
- modal real
- tabs
- inputs
- selects
- toast
- foco

### Observacoes de smoke
- `Soft`, `Balanced` e `Expressive` permaneceram na mesma familia visual;
- `Arquivos` confirmou thumbnails e modal real sem competicao da atmosfera;
- `Galeria` permaneceu funcional, mas com carregamento mais lento; houve observacao intermediaria de `0 outputs` durante loading, nao classificada como regressao do DS-1D;
- `Light`, `Dark` e `System` mantiveram ausencia de tipografia e atmosfera Studio;
- nao houve hydration error novo;
- `system` nao virou `studio`;
- a preferencia remota foi restaurada apos login.

## Checks
- teste direcionado: passando
- teste completo: passando
- `typecheck`: passando
- `build`: passando
- lint pontual: sem erros, com aviso esperado para CSS ignorado pela configuracao atual
- lint global: sem erros, com warnings preexistentes fora do escopo do DS-1D

## Itens deferidos para DS-1E
- refinamento de controles;
- badges e indicadores;
- bordas superiores contextuais;
- cards de dominio e familias especificas;
- densidade operacional de alguns paines.

## Itens deferidos para DS-1F
- microdetalhes visuais de dominio;
- estados e acentos contextuais por fluxo;
- refinamentos especificos para galerias, filters e chrome de midia.

## Refinamento futuro contra Hermes
Ainda podem evoluir em rodada posterior:

- grid mais evidente e calibrado;
- maior presenca lilas no topo esquerdo;
- controles menos herdados do baseline shadcn;
- anatomias de cards mais proximas do control board;
- badges e indicadores mais tecnicos;
- microdetalhes editoriais e operacionais.

Esses pontos nao bloqueiam o DS-1D.

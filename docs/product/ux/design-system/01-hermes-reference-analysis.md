# Hermes Reference Analysis

O documento `dashboard_ref.html` e um dashboard estetico (Hermes Mission Control) usado como fonte de inspiracao para os tokens e composicoes de layout do Content Agent Studio. Ele não é para ser copiado literalmente. Abaixo está a analise estrutural deste arquivo.

## 1. Foundations

- **Cores e Atmosfera**: Fundo dominantemente noturno (`#15151F`), uso de grids sutis (`dot-grid`) e atmosferas (`radial-gradient`, brilhos). Tokens principais incluem variantes vivas como Violet (`#8B5CF6`), Cyan (`#7DD3FC`), Mint (`#5EE2B5`), Magenta (`#E879F9`), e Amber (`#F5B544`).
- **Superficies**: Uso extensivo de "glassmorphism" (`background: rgba(31,31,43,0.55)`, `backdrop-filter: blur(34px)`).
- **Bordas e Sombras**: Bordas extremamente finas e translucidas (`border: 1px solid rgba(255,255,255,0.105)`), com contrastes altos e sombras suaves e brilhantes (glows).
- **Tipografia**: Contrastes hibridos usando fontes primarias limpas (`Inter Tight` para cabecalhos) e espacamento mono para metadados e displays de engenharia (`JetBrains Mono`). Textos muitas vezes com `letter-spacing` alto para criar aura tecnologica e rigorosa.
- **Radius**: Radius curvos generosos nas superficies principais (`30px`, `24px`) balanceados com formas menores redondas (status pills `999px`).

## 2. Components

Componentes identificaveis reutilizaveis pelo CA Studio:
- **Navigation Tabs**: Tabs suspensos envoltos numa pill, com borda sutil e backgrounds translucidos, reativo ao estado ativo.
- **Status Pill**: Mostrador de estado da maquina, com "pulse dots" brilhantes, que podem informar contextos (e.g., conexao Supabase).
- **Glass Cards**: Cards de fundo translucido usados exaustivamente para encapsular widgets e dados (Metric cards, Agent cards).
- **Entity Cards**: Listagens complexas de entidades (como Kanban ou Feed) em layouts concisos e hierarquicos.
- **Metric Strip**: Paineis em linha com exibicao focal de numeros-chave e variaveis de estado (bom para uso no Hub de dashboard e Galerias globais).
- **Tables (Logs Table)**: Listas densas, cabeçalhos de tabela sticky, onde atributos de metadados se tornam monoespacejados para facilitar escaneabilidade.
- **Progress Bars**: Modulos lineares que denotam progresso e capacidade de utilizacao usando glow (`box-shadow: 0 0 14px`).

## 3. Composition Patterns

- **Operational Overview**: Combinacao de Heros textuais / "Radar" animado, metricas horizontais e um log de atividade inferir, proporcionando varredura "de comando".
- **Split Library / Reader**: Uma composicao com navegacao/filtro lateral, e um detalhe robusto (ou formulario) a direita, optimo para geracao ou edicao detalhada (Context Workspace).
- **Entity Collection (Board Grid/Cards)**: Grade densa com cards interativos complexos, focados em acao rapida.
- **Calendar / Schedule Blocks**: Grid temporal com dots para indicar densidade, otimo caso necessario visualizar agendamentos ou cronologia futura de drafts.

## 4. Responsive Behavior

A responsividade observada em CSS Media Queries:
- **1100px**: Tabs adaptam-se. Grids complexos colapsam para `1fr`. Top-nav condensa.
- **680px**: Pads (espacamentos) internos menores (22px). Elementos viram single-column `1fr`. Labels podem esconder-se ou abas quebram linhas. Tabs encapsulam mais curtos. O encolhimento e feito via stacking global.

## 5. Risks & Contraindicacoes para o Content Agent

O Content Agent Studio deve herdar as estruturas sem os vicios:
- **Background Noise**: O uso excessivo de atmosferas brilhantes (gradientes radiais violetas) e background blurs causa reducao massiva na leitura, caso hajam muitos formularios complexos. O CA Studio precisa de uma variante de legibilidade alta (Light e Dark mais secas, deixando o Glow e Dot-Grid para o modo **Studio**).
- **Cores de Alta Saturacao Textual**: Texto mono pequeno, colorido em cyan ou verde brilhante sobre translucido prejdica a Acessibilidade (WCAG). Textos devem ser preferencialmente High-contrast com destaques de background, e nao textos inteiramente brilhantes, a menos que sejam decorativos.
- **Backdrop-Filter Performance**: Excessivos `backdrop-filter` aplicados as camadas filhas, pais e irmas provocam frame-drops violentos. Deve haver uso cauteloso apenas nas cascas (shells) ou modais isolados.
- **Visual Tecnico Exacerbado**: Radar, relogios e contadores de "VPS" nao pertencem ao CA Studio. Devem ser trocados por controles calmos focados em textos, criacao de conteudo e assets midia de alto padrao semantica. O produto CA foca em *criatividade*, o Hermes foca em *monitoramento*, portanto a casca serve, o conteudo nao.

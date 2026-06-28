# Theme Mapping Plan (DS-1A)

## Visao geral
O sistema preve tres temas distintos mapeados sobre os mesmos tokens semanticos e a mesma estrutura HTML.
A chave de sucesso e garantir que anatomias e contratos funcionais aprovados permaneçam imutaveis.
No codigo atual, apenas `:root` e `.dark` existem em `app/globals.css`; `studio` ainda e hipotese documental e precisa nascer sobre a mesma anatomia, nao em componentes paralelos.

## Papeis compartilhados
Independentemente do tema ativo:
- **Canvas vs cards**: a distincao entre fundo e elementos contidos deve ser mantida
- **Hierarquia de texto**: `primary`, `secondary` e `muted` precisam manter saltos de contraste claros
- **Feedback**: erro, success, warning e info precisam existir em todos os temas
- **Anatomia DOM**: nenhuma classe estrutural de layout deve mudar por causa do tema
- **Responsividade**: max-widths, wraps, stacks e overflow interno aprovados no UX-H4 precisam permanecer iguais entre `light`, `dark` e `studio`
- **Estados**: loading, empty, filtered empty, error, success, selected e disabled precisam conservar contraste e hierarquia nos tres temas

## 1. Tema Light
- **Prioridade:** clareza e alta legibilidade para trabalho continuo
- **Superficies:** sombras sutis, boa separacao entre canvas e cards, sem depender de glass
- **Bordas:** delimitadores perceptiveis sem ruido excessivo
- **Ruido visual:** baixo; sem atmosfera pesada de glow ou gradiente

## 2. Tema Dark
- **Restricoes:** evitar massa uniforme escura e cards indistinguiveis do canvas
- **Superficies:** cards e paineis precisam manter leitura clara de limite
- **Bordas:** intensidade suficiente para evitar perda de estrutura
- **Ruido visual:** baixo a medio; sem preto absoluto dominante

## 3. Tema Studio
- **Objetivo:** reinterpretacao sofisticada das referencias Hermes sem reabrir o UX-H4
- **Identidade estetica:** injecao seletiva de violetas, cianos, menta e rosa em highlights, reaproveitando a linguagem que ja aparece hoje em CTA, shell e estados do produto
- **Limites estritos do Studio:**
  - nao cria componentes proprios
  - nao muda DOM
  - nao altera responsividade
  - nao transforma glass em default universal
  - nao transforma glow em default universal
  - nao reduz contraste para favorecer atmosfera
  - nao deve parecer dashboard gamer
  - precisa preservar acessibilidade de focus, hover, selected, badges e callouts

## Dependencias tecnicas antes do Studio
Antes de mapear `studio`, o sistema ainda precisa fechar:
- como `light` e `dark` serao ativados de forma consistente
- qual sera o escopo tecnico do terceiro tema (`.theme-studio`, `data-theme` ou equivalente)
- como preservar compatibilidade com shadcn, `next-themes` e componentes que hoje assumem apenas `light/dark`

## Valores que ainda dependem de validacao humana
Estas decisoes nao podem ser tomadas apenas lendo o codigo. Requerem validacao visual humana em telas piloto.

1. **Familia tipografica final**
   Impacto: define o tom de voz do app e interfere em layouts densos
2. **Grau de arredondamento**
   Impacto: muda a sensacao utilitaria vs macia dos componentes
3. **Densidade base**
   Impacto: define quanto conteudo cabe em hubs, dialogs e formularios
4. **Contraste das bordas**
   Impacto: afeta orientacao estrutural, especialmente em dark e studio
5. **Intensidade do dark**
   Impacto: evita tela agressiva ou massa escura sem hierarquia
6. **Peso do brand accent**
   Impacto: define se violet/cyan seguem como marca principal de CTA e selecao ou recuam para papel mais pontual
7. **Intensidade atmosferica do Studio**
   Impacto: define saturacao de fundos, highlights e acentos
8. **Presenca de dot grid**
   Impacto: pode gerar textura interessante ou ruido/moire
9. **Uso e alcance do glass**
   Impacto: decide onde blur/translucidez e seguro para leitura e performance
10. **Nivel de translucidez das superficies**
   Impacto: decide se o padrao atual `bg-card/30 + border-border/50 + backdrop-blur-sm` vira semantica oficial, excecao controlada ou heranca a ser reduzida
11. **Uso de fonte monoespacada**
   Impacto: identifica campos e metadados que pedem alinhamento tabular

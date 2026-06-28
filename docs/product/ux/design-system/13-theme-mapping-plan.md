# Theme Mapping Plan (DS-1A)

## Visão Geral
O sistema prevê três temas distintos mapeados sobre os mesmos tokens semânticos e estrutura HTML (UX-H4 mantido).
A chave de sucesso é a garantia de que as anatomias e contratos funcionais aprovados permaneçam imutáveis. Os temas manipulam apenas a superfície estética (oklch, sombras, borders).

## Papéis Compartilhados
Independentemente do tema ativo:
- **Canvas vs Cards**: A distinção entre fundo (canvas) e elementos contidos (cards, hubs) deve ser mantida.
- **Hierarquia de Texto**: `primary`, `secondary` e `muted` sempre terão saltos de contraste claros.
- **Feedback**: Cores semânticas de erro e sucesso devem existir em todos os temas.
- **Anatomia DOM**: Nenhuma classe estrutural do Tailwind (flex, grid, dimensões base) será alterada.

## 1. Tema Light
- **Prioridade:** Clareza, alta legibilidade para edição (modo de trabalho).
- **Superfícies:** Uso sutil de sombras para distinção de profundidade; canvas off-white (`#f8f9fa` / equivalentes oklch) e cards `#ffffff`.
- **Bordas:** Delimitadores perceptíveis sem gerar ruído opressivo (e.g., `#e2e8f0`).
- **Ruído Visual:** Baixo. Sem uso de gradientes atmosféricos.

## 2. Tema Dark
- **Restrições:** Evitar a massa uniforme escura e fundos de card indiferenciáveis do canvas. 
- **Superfícies:** Canvas em preto fosco elevado (ex: `#121212`), com superfícies de cards ligeiramente mais claras para percepção do limite.
- **Bordas:** Usadas com intensidade suficiente (ex: transparência branca fraca) para evitar que a interface se torne uma "massa flutuante".
- **Ruído Visual:** Baixo/Médio. Evita preto absoluto (`#000000`).

## 3. Tema Studio
- **Objetivo:** Uma reinterpretação sofisticada das referências do protótipo Hermes, focada em geração estética ("mágica").
- **Identidade Estética:** Injeção seletiva de violetas, cianos, menta e rosa em highlights de estado e status pills. 
- **Limites Estritos do Studio:** 
  - **Proibição de alteração estrutural:** Não criará componentes próprios e não afetará a anatomia UX-H4.
  - **Legibilidade:** Não reduzirá legibilidade para favorecer estética. 
  - **Glass restrito:** Transparências (glass) apenas em popovers, sidebars embutidas ou header flutuante. Não em painéis fundamentais que exigem contraste sólido para leitura editorial.
  - **Controle de Glow:** Restrito a focos centrais, contornos seletivos e interações. Não deve parecer um "dashboard gamer".

## Decisões Humanas Requeridas
Estas decisões não podem ser tomadas apenas lendo o código. Requerem validação visual humana baseada em provas conceituais (pilot screens):

1. **Família Tipográfica Final**
   - *Impacto:* Determina o "tom de voz" do app (Geist vs Inter, etc.).
   - *Dependência:* Base tipográfica afeta layouts densos.
2. **Grau de Arredondamento (Radius)**
   - *Impacto:* Sensação mais utilitária vs "amigável/macia" nos componentes interativos.
3. **Densidade Base**
   - *Impacto:* Definição dos espaçamentos globais, que impactam quanta informação cabe nos hubs e modais.
4. **Contraste das Bordas**
   - *Impacto:* Perceção de estruturação, especialmente nos modos Dark e Studio onde bordas invisíveis causam desorientação.
5. **Intensidade do Dark**
   - *Impacto:* Escala física neutra base, prevenindo a temida tela de alto contraste.
6. **Intensidade Atmosférica do Studio**
   - *Impacto:* Nível de saturação de background gradients.
7. **Presença do Dot Grid**
   - *Impacto:* A malha pontilhada gera textura, mas pode causar ruído e moiré na interface.
8. **Uso e Alcance do Efeito Glass**
   - *Impacto:* Determinação exata de onde aplicar background blurs translúcidos com segurança de performance e legibilidade.
9. **Uso de Fonte Monoespaçada**
   - *Impacto:* Identificação de campos e metadados que pedem alinhamento tabular (IDs, timestamps).

# Content Agent Studio — Base de Conhecimento Arquitetural

Esta pasta contém a documentação conceitual e arquitetural do Content Agent Studio,
produzida durante as sessões de análise da Fase 2.

Os documentos aqui não descrevem implementação. Descrevem o **entendimento do
sistema** — o que ele é, como funciona, o que deve se tornar.

---

## Ordem recomendada de leitura

### Estudos de UX

- [UX Baseline Audit - Pre-Reconciliation](./product/ux/ux-baseline-audit-pre-reconciliation.md)  
  Fotografia prática da experiência antes da reconciliação atual de Project Identity / Production.

- [UX Reconciliation Audit - Post Project Identity](./product/ux/ux-reconciliation-audit-post-project-identity.md)  
  Segunda auditoria pratica confrontando produto percebido, Project Identity, Production workspace e experiencia real no browser.

- [UX Production Hardening Results](./product/ux/ux-production-hardening-results.md)
  Fechamento do UX-H1 com correcoes localizadas de continuidade da Production, loading e retorno contextual.

### 1. [ARCHITECTURE.md](./ARCHITECTURE.md)
**Reconstrução da arquitetura atual**

Leia primeiro. Mapeia o estado real do sistema comprovado pelo código:
stack tecnológica, entidades existentes, API routes, fluxos implementados,
agentes implícitos, artefatos persistentes, pontos fortes e pontos de atenção.

É a fonte de verdade sobre o que existe hoje.

---

### 2. [DOMAIN_EVOLUTION.md](./DOMAIN_EVOLUTION.md)
**Evolução do domínio e descoberta das entidades**

Leia segundo. Responde às perguntas estratégicas da Fase 2:
qual é a entidade central real, quais entidades atuais são apenas implementação,
como os agentes evoluem, como o pipeline emerge naturalmente, e qual é o
roadmap conceitual (Fases A, B, C, D).

Identifica a entidade ausente entre `Project` e os workspaces especializados
e propõe o modelo de domínio evoluído com a entidade `Production`.

---

### 3. [PRODUCTION_LIFECYCLE.md](./PRODUCTION_LIFECYCLE.md)
**Comportamento da entidade Production**

Leia terceiro. Modela o ciclo de vida completo da entidade `Production`:
como nasce, quais informações mínimas precisa, como seus estados evoluem,
quais artefatos contém, como os agentes colaboram dentro ela, como se
relaciona com o Projeto, se pode gerar Produções derivadas, e como o modelo
se valida em diferentes domínios (editorial, branding, pesquisa, automações, etc.).

---

### 4. [PRODUCTION_DECISIONS.md](./PRODUCTION_DECISIONS.md)
**Decisões arquiteturais antes da implementação**

Leia antes de qualquer implementação da entidade `Production`. Responde a 7
perguntas arquiteturais que, sem resposta, forçariam retrabalho durante o
desenvolvimento:

- D1: Qual agente inicia universalmente toda Produção
- D2: Qual é a precedência de contexto entre Projeto, Produção e artefato
- D3: Quais status são derivados de artefatos e quais requerem evento explícito
- D4: Como o sistema lida com Produções criadas sem Projeto selecionado
- D5: Como o sistema de tipos funciona (enum + capabilities map)
- D6: Critérios para distinguir Produção derivada de artefato da mesma Produção
- D7: O que IA pode aprovar autonomamente vs. o que sempre requer decisão humana

Inclui invariantes do domínio e o papel futuro do Production Architect (Fase C).

---

### 5. [PRODUCTION_IMPLEMENTATION_PLAN.md](./PRODUCTION_IMPLEMENTATION_PLAN.md)
**Plano incremental de implementação**

Leia antes de escrever qualquer código para a entidade `Production`. Contém:

- Estado confirmado do código atual (schema real, padrões de FK e RLS, como o
  projeto é mantido na UI, quais colunas são nullable)
- Escopo exato do MVP (o menor incremento utilizável por um usuário real)
- Campos da primeira versão e o que foi explicitamente adiado
- Relações com entidades existentes e estratégia de backfill (nenhum)
- Vertical slice completo com 13 passos de teste
- 5 incrementos independentes com critérios de aceite e rollback individuais
- 4 decisões que ainda exigem confirmação humana antes de implementar

---

### 6. [PUBLICATION_DOMAIN_DISCOVERY.md](./PUBLICATION_DOMAIN_DISCOVERY.md)
**Descoberta de domínio — Publicações**

Leia antes de qualquer trabalho no domínio de publicações. Diagnóstico da entidade
`Post` híbrida existente: por que mistura conteúdo editorial, adaptação de canal e
distribuição numa única entidade. Inclui 10 cenários mandatórios, avaliação de
nomenclatura e modelo progressivo em 3 níveis (MVP / Próxima Evolução / Futuro).

Congelado: nenhuma nova funcionalidade na entidade `Post` até decisões de domínio
concluídas.

---

### 7. [PUBLICATION_DOMAIN_DECISIONS.md](./PUBLICATION_DOMAIN_DECISIONS.md)
**Decisões formais de domínio — Publicações (Rev. 2)**

Leia antes de qualquer implementação das entidades de publicação. Converte o
mapeamento exploratório da descoberta em 20 decisões formais (PUB-D1 a PUB-D20):

- PUB-D1/D2: Por que `EditorialContent` e `ChannelPiece` (não `ContentDraft`, não `PostVariant`)
- PUB-D3: Modelo central `EditorialContent → ChannelPiece → Distribution`
- PUB-D4: `Distribution` adiada — requer integração com APIs externas
- PUB-D5/D6/D7: Restrições de FK (`project_id` NOT NULL RESTRICT, `production_id` SET NULL, `editorial_content_id` CASCADE)
- PUB-D8–D15: Canal, cardinalidades, aprovação, assets, legado `Post`, congelamento
- PUB-D16: `channel` e `format` são campos separados; `PublicationType` não é herdado
- PUB-D17: `ChannelPiece.status` não inclui `published` — ato de publicação pertence a `Distribution`
- PUB-D18: Campo de texto adaptado se chama `body` (não `feed_text`)
- PUB-D19: `image_url` não entra em `ChannelPiece` em P1–P5
- PUB-D20: Rotas aprovadas — `/publicacoes` (hub), `/projetos/[id]/conteudos/[id]` (detalhe)

Inclui mapeamento do legado `Post` com channel+format, ciclo de vida de cada entidade,
fluxos de uso (publicação rápida e pós-vídeo), estrutura da aba Publicações, rotas
aprovadas e escopo de P1–P6.

---

### 8. [PUBLICATION_IMPLEMENTATION_PLAN.md](./PUBLICATION_IMPLEMENTATION_PLAN.md)
**Plano incremental de implementação — Publicações**

Leia antes de escrever qualquer código para as entidades de publicação. Contém:

- Estado confirmado do código atual (tabelas, APIs, padrões de FK e RLS)
- Schema completo de `editorial_contents` e `channel_pieces` com SQL da migration 021
- Valores válidos de `channel` e `format` com mapeamento do legado `PublicationType`
- Rotas aprovadas e comportamento de cada uma
- Estratégia de migração de `posts` (condicionada a auditoria — não em P1–P6)
- 6 incrementos (P1–P6) com: objetivo, escopo, dependências, arquivos afetados,
  critérios de aceite, testes, riscos e rollback individuais
- Dívida documental registrada (não bloqueia implementação)

---

## Relação entre os documentos

---

## Relação entre os documentos

```
ARCHITECTURE.md                   →  "o que existe hoje"
     ↓
DOMAIN_EVOLUTION.md               →  "o que deve existir e por quê"
     ↓
PRODUCTION_LIFECYCLE.md           →  "como a Production se comporta"
     ↓
PRODUCTION_DECISIONS.md           →  "o que decidir antes de implementar Production"
     ↓
PRODUCTION_IMPLEMENTATION_PLAN    →  "como implementar Production, em que ordem"
     ↓
PUBLICATION_DOMAIN_DISCOVERY.md   →  "diagnóstico do Post híbrido e 10 cenários"
     ↓
PUBLICATION_DOMAIN_DECISIONS.md   →  "decisões formais do domínio de publicações (Rev. 2)"
     ↓
PUBLICATION_IMPLEMENTATION_PLAN   →  "como implementar publicações, em que ordem (P1–P6)"
```

---

## Decisões de linguagem de domínio

Durante a análise, foram avaliados os seguintes candidatos para a entidade
intermediária entre `Project` e os workspaces especializados:

`Pauta`, `Tema`, `Produção`, `Brief`, `Creative Brief`, `Job`, `Session`,
`Work Item`, `Assignment`, `Criação`

**Decisão:** `Production` (Produção) foi escolhido por ser o único candidato que:
- Funciona para todos os domínios propostos (editorial, branding, pesquisa, IA, automações)
- Não pertence a nenhum nicho específico
- Tem ciclo de vida implícito ("em produção" → "concluída")
- Produz código limpo (`production_id`, `/api/productions`, tabela `productions`)

---

## Recomendações de reorganização futura

À medida que a Fase 2 avança, estes documentos podem precisar ser divididos:

- **ARCHITECTURE.md** pode ser dividido em `ARCHITECTURE_CURRENT.md` (estado do código)
  e `ARCHITECTURE_DECISIONS.md` (decisões técnicas e por quê foram tomadas)

- **DOMAIN_EVOLUTION.md** pode gerar um `ROADMAP.md` separado focado apenas nas
  Fases A, B, C, D com critérios de entrada e saída de cada fase

- **PRODUCTION_LIFECYCLE.md** pode gerar um `AGENT_CATALOG.md` separado descrevendo
  cada agente, seus inputs, outputs e em quais tipos de Produção aparecem

Por enquanto, a estrutura atual (três documentos, leitura sequencial) é suficiente
para a base de conhecimento da Fase 2.

---

## Questões em aberto consolidadas

**Respondidas em PRODUCTION_DECISIONS.md (prontas para implementação da Fase B):**
- ~~O `evaluation_mode` da Produção sobrescreve o do Projeto ou o herda?~~ → D2
- ~~O tipo da Produção é um enum fechado ou extensível?~~ → D5
- ~~Uma Produção pode existir sem Projeto?~~ → D4
- ~~A fronteira entre "artefato" e "Produção derivada"~~ → D6
- ~~Quem é o agente universal de início?~~ → D1
- ~~O que IA pode aprovar vs. o que requer humano?~~ → D7

**Respondidas em PRODUCTION_IMPLEMENTATION_PLAN.md (prontas para o Incremento B):**
- ~~Schema mínimo da tabela `productions`~~ → Seção 3
- ~~Relações com entidades existentes~~ → Seção 4
- ~~O que fazer com dados existentes~~ → Seção 8 (nenhum backfill)
- ~~Sequência de incrementos~~ → Seção 6

**Pendentes — exigem confirmação humana antes de implementar (D.H. no plano):**
- D.H.1: Rota `/projetos/[id]/producoes/[id]` ou `/producoes/[id]`?
- D.H.2: Título obrigatório separado ou gerado da intenção?
- D.H.3: AlertDialog de delete do Projeto deve mostrar contagem de Produções?
- D.H.4: 1, 3 ou 7 tipos visíveis na UI do MVP?

**Pendentes para a Fase C (agentes editoriais):**
- A interface de aprovação do `production_brief`: Planejador roda automaticamente
  ou aguarda confirmação do usuário?
- Como `style_profile` de Projeto e Produção interagem — adição ou override?

**Pendentes para a Fase D (pipeline como produto):**
- Como representar redes de Produções derivadas na UI sem criar complexidade?
- Produções derivadas herdam `evaluation_mode` da fonte ou do Projeto?
- UI de migração de Produções entre Projetos.

**Respondidas em PUBLICATION_DOMAIN_DECISIONS.md Rev. 2 (prontas para implementação P1–P6):**
- ~~Como separar o `Post` híbrido em responsabilidades distintas?~~ → PUB-D3
- ~~A entidade central de conteúdo se chama `ContentDraft` ou o quê?~~ → PUB-D1 (`EditorialContent`)
- ~~A adaptação de canal se chama `PostVariant` ou o quê?~~ → PUB-D2 (`ChannelPiece`)
- ~~Quem decide o canal — o conteúdo ou a adaptação?~~ → PUB-D8 (`ChannelPiece`)
- ~~`EditorialContent` pode existir sem `ChannelPiece`?~~ → PUB-D9 (sim)
- ~~O que a aba Publicações da Produção exibe?~~ → PUB-D10 (`EditorialContent`s com `ChannelPiece`s expandíveis)
- ~~Aprovação formal é necessária nesta fase?~~ → PUB-D11 (não — manual)
- ~~`Distribution` deve ser implementada agora?~~ → PUB-D4 (não — adiada)
- ~~Como `Post` mapeia para o novo modelo?~~ → PUB-D13 (1 Post → 1 EditorialContent + 1 ChannelPiece)
- ~~Canal e formato devem ser campos separados?~~ → PUB-D16 (sim; `PublicationType` não é herdado)
- ~~`ChannelPiece.status` deve ter `published`?~~ → PUB-D17 (não; pertence a `Distribution`)
- ~~O campo de texto adaptado se chama `feed_text`?~~ → PUB-D18 (não; se chama `body`)
- ~~`image_url` entra no schema de `ChannelPiece`?~~ → PUB-D19 (não em P1–P5)
- ~~Qual é a rota global de publicações?~~ → PUB-D20 (`/publicacoes` e `/projetos/[id]/conteudos/[id]`)

**Pendentes para versões multi-usuário (futuro):**
- Quem tem autoridade para aprovação de entrega em equipes?
- Como `approved_by` se comporta com múltiplos aprovadores?

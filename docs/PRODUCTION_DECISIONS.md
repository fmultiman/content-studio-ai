# Content Agent Studio — Decisões Arquiteturais: Production
**Fase 2 · Pré-implementação · Junho 2026**

> Este documento registra as decisões arquiteturais que devem ser tomadas **antes**
> de qualquer implementação da entidade `Production`.
>
> Cada decisão inclui: recomendação, alternativas consideradas, justificativa,
> consequências e itens adiados.
>
> Ao final: invariantes do domínio e o papel do Production Architect.

---

## Como ler este documento

Cada seção responde uma pergunta que, se deixada em aberto, forçaria retrabalho
durante a implementação. As decisões são interdependentes — leia na sequência.

```
D1: Agente universal de início
D2: Precedência de contexto
D3: Status derivado vs. explícito
D4: Produção sem Projeto
D5: Sistema de tipos
D6: Derivada vs. artefato
D7: Aprovação humana
```

---

## D1 — Agente Universal de Início

**A pergunta:** "Estrategista Editorial" é o agente universal que inicia toda Produção,
ou o nome é errado e o conceito precisa ser refinado antes da implementação?

### Decisão recomendada

**Criar um agente orquestrador universal chamado "Planejador de Produção".**
O "Estrategista Editorial" se torna uma especialização deste agente, aplicável
apenas a produções dos tipos `editorial`, `branding` e `campaign`.

O Planejador de Produção:
- É o único agente que SEMPRE roda primeiro, em toda Produção, independente do tipo
- Lê `intention + project_context + type + channel`
- Produz `production_brief`: um documento estruturado com os campos que os agentes
  especializados vão consumir
- Não executa nenhum artefato criativo — prepara o contexto para quem vai executar

O `production_brief` que ele produz varia por tipo:

| Tipo de Produção | Campos que o brief inclui |
|------------------|--------------------------|
| editorial, branding, campaign | `editorial_angle`, `audience`, `tone`, `visual_direction` |
| research | `research_scope`, `sources_approach`, `output_format`, `key_questions` |
| documentation | `audience_level`, `format`, `sections_suggested`, `tone` |
| digital_product | `value_proposition`, `target_persona`, `visual_direction`, `copy_goals` |
| automation, ai_project | `problem_definition`, `expected_outputs`, `constraints`, `acceptance_criteria` |

### Alternativas consideradas

**A) Manter "Estrategista Editorial" como universal.**
Problema: o nome presupõe editorial. Uma Produção de automação não tem "estratégia
editorial" — tem definição de problema. O nome errado gera resistência mental do
usuário e do desenvolvedor.

**B) Sem agente universal — cada tipo começa com um agente próprio.**
Problema: a lógica de "qual agente roda primeiro?" fica distribuída por tipo.
Adicionar um novo tipo exige decidir sobre este ponto novamente. O contexto que
TODA Produção precisa (intenção processada, audiência, direção geral) teria que
ser gerado de formas diferentes para cada tipo.

**C) Production Architect como agente separado do Planejador.**
O "Production Architect" descrito na pergunta — que lê intenção, identifica tipo,
sugere pipeline completo, seleciona agentes e prepara briefings — É o Planejador
de Produção. Não são dois agentes; são o mesmo papel com dois nomes. O nome
"Planejador" é mais acessível para criadores; "Production Architect" é mais
preciso conceitualmente mas soa técnico para o usuário.

### Justificativa

O código atual revela o padrão: `generate-feed-text/route.ts` recebe `projectId`
e busca o contexto do Projeto para combinar com a instrução local. O Planejador
de Produção formaliza exatamente este padrão, mas para toda a Produção — não
apenas para o Feed Generator.

Ter um agente universal de início também resolve um problema futuro: quando novos
tipos de Produção forem adicionados, a interface com o usuário não muda ("começar
Produção" sempre invoca o Planejador). Só o `production_brief` muda de forma.

### Consequências

- O código terá uma rota `/api/productions/plan` (ou similar) que é o ponto de
  entrada universal de qualquer Produção
- O `production_brief` se torna um artefato de processo obrigatório de toda Produção
- "Estrategista Editorial" existe no código mas como uma função interna do
  Planejador para tipos `editorial | branding | campaign`, não como agente separado
- A UI pode mostrar "Planejando sua Produção..." enquanto roda, independente do tipo

### Adiado

A interface de aprovação do `production_brief` pelo usuário — ou seja: o Planejador
roda automaticamente ou o usuário confirma antes dos agentes especializados rodarem?
Esta decisão pertence à Fase C (implementação de agentes) e depende da UX validada
com usuários reais.

---

## D2 — Precedência de Contexto

**A pergunta:** Quando Project.context, Production.intention, Production.editorial_angle
e um override local no artefato coexistem, qual prevalece? O `evaluation_mode` da
Produção sobrescreve o do Projeto?

### Decisão recomendada

**Os campos de contexto seguem regras diferentes conforme sua natureza:**

#### Campos aditivos — cada camada enriquece a anterior

```
[padrão do sistema]
    + [Project.context]           ← identidade permanente da marca
    + [Project.style_profile]     ← direção estética de toda a marca
    + [Production.intention]      ← propósito específico desta produção
    + [Production.editorial_angle]← direção editorial escolhida (quando existe)
    + [artefato.local_context]    ← instrução específica do workspace atual
```

Ao construir o prompt de qualquer agente, TODOS os campos presentes são incluídos.
Camadas mais específicas têm PESO SEMÂNTICO maior — o agente deve priorizar
instrução mais específica quando houver contradição, mas nunca descartar a geral.

#### Campos de override — o mais específico sobrescreve

| Campo | Regra |
|-------|-------|
| `evaluation_mode` | `artefato local > Production > Project > 'default'` |
| `channel` | `Production > Project > (sem canal)` |
| `format` | `artefato local > Production > (não definido)` |
| `model` (de imagem) | `UserSettings > (default do sistema)` |

O `evaluation_mode` da Produção SEMPRE sobrescreve o do Projeto quando definido.
Se `Production.evaluation_mode` não for definido (null), usa o do Projeto.
Se o do Projeto também não for definido, usa `'default'`.

#### O invariante de contexto

Agentes recebem sempre um envelope de contexto com esta estrutura:

```
{
  system_context:     "<instruções gerais do sistema>",
  project_context:    "<Project.context + Project.style_profile>",
  production_context: "<Production.intention + Production.editorial_angle>",
  local_context:      "<instrução específica do artefato, se houver>",
  evaluation_mode:    "<modo resolvido pela precedência acima>"
}
```

Não existe "apenas usar o do Projeto" ou "apenas usar o da Produção" — ambos
sempre chegam ao agente. A semântica de qual instrução o agente prioriza é
responsabilidade do prompt do agente.

### Alternativas consideradas

**A) Hierarquia simples onde o mais específico apaga o mais geral.**
Problema: se `Production.editorial_angle` é muito específico, o Project.context
(identidade de marca) seria ignorado. Isso geraria imagens ou copy coerentes com
o ângulo editorial mas incoerentes com a marca.

**B) Projeto é absoluto — Production e artefatos só refinam, nunca sobrescrevem.**
Problema: impossibilita que uma campanha comercial dentro de um projeto
"conceptual" use `evaluation_mode: 'commercial'`. O código atual já tem
`Post.ai_context` como override local — o modelo não pode ser mais restritivo
que o código existente.

### Justificativa

O código atual em `generate-feed-text/route.ts` já implementa o modelo aditivo
implicitamente: `projectContext` é concatenado com `aiContext` no mesmo prompt.
Quando `aiContext` existe, ele refina sem apagar o `projectContext`. A decisão
formaliza e estende este padrão existente.

O override de `evaluation_mode` é necessário porque o critério de qualidade
varia DENTRO do mesmo projeto. Um cliente de marca premium pode ter projetos
com `evaluation_mode: 'aesthetic'` mas precisar de uma campanha com
`evaluation_mode: 'commercial'` sem criar um novo Projeto.

### Consequências

- O código que monta prompts deve seguir o envelope estruturado — nenhum agente
  constrói seu próprio contexto arbitrariamente
- `Production.evaluation_mode` é um campo nullable — null significa "herdar do Projeto"
- Toda API de agente recebe o `evaluation_mode` já resolvido (não raw do banco)
- Testar um agente com contexto diferente é fácil: basta mudar o `local_context` no envelope

### Adiado

Como `style_profile` do Projeto e da Produção interagem em detalhe — se a Produção
pode ADICIONAR termos ao style_profile ou apenas sobrescrevê-lo. Esta granularidade
é relevante na Fase C quando o Planejador começa a gerar direção visual.

---

## D3 — Status Derivado vs. Eventos Explícitos

**A pergunta:** Quais estados da Produção podem ser derivados dos artefatos e quais
precisam de eventos explícitos do usuário? O `PRODUCTION_LIFECYCLE.md` diz que
"status é derivado" — mas isso é verdadeiro para todos os estados?

### Decisão recomendada

**Modelo híbrido: status é COMPUTADO a partir de marcadores de timestamp.**

A Produção armazena timestamps de eventos significativos. O status é computado
a partir desses timestamps na seguinte precedência:

```
cancelled_at    → CANCELADA    (irreversível, mais alta prioridade)
paused_at       → PAUSADA      (sem cancelled_at)
archived_at     → ARQUIVADA    (sem os anteriores)
published_at    → PUBLICADA    (sem os anteriores)
completed_at    → PRONTA       (sem os anteriores)
review_started_at → EM REVISÃO (sem os anteriores)
[tem artefatos] → EM PRODUÇÃO  (sem nenhum marcador)
[sem artefatos] → ABERTA       (fallback)
```

#### Estados derivados dos artefatos (automáticos, sem evento)

| Transição | Gatilho |
|-----------|---------|
| `ABERTA` → `EM PRODUÇÃO` | Primeiro artefato de trabalho é criado (ImageDraft, VideoDraft, etc.) |
| `EM PRODUÇÃO` → `ABERTA` | Todos os artefatos de trabalho são deletados (raro, mas válido) |

#### Estados por eventos explícitos do usuário (persistidos via timestamp)

| Estado | Ação do usuário | Campo persistido |
|--------|----------------|-----------------|
| `EM REVISÃO` | "Enviar para revisão" | `review_started_at` |
| `PRONTA` | "Marcar como pronta" | `completed_at` |
| `PUBLICADA` | "Marcar como publicada" | `published_at` |
| `CANCELADA` | "Cancelar produção" | `cancelled_at` |
| `PAUSADA` | "Pausar produção" | `paused_at` |
| `ARQUIVADA` | "Arquivar" | `archived_at` |

#### Reversibilidade

| Transição | Reversível? |
|-----------|-------------|
| EM REVISÃO → EM PRODUÇÃO | Sim (zera `review_started_at`) |
| PRONTA → EM REVISÃO | Sim (zera `completed_at`) |
| PUBLICADA → qualquer | Não (convenção de domínio) |
| CANCELADA → qualquer | Não (apenas "desarquivamento" manual) |
| ARQUIVADA → qualquer | Sim (mas requer ação manual explícita) |
| PAUSADA → EM PRODUÇÃO | Sim (zera `paused_at`) |

### Por que não puramente derivado

O `PRODUCTION_LIFECYCLE.md` propôs derivação pura:
```
Se há artefatos sob avaliação → Em Revisão
Se todos artefatos aprovados  → Pronta
```

Este modelo falha em dois pontos:

1. **"Em Revisão" não pode ser derivado dos artefatos**: artefatos podem estar
   "sob avaliação" durante toda a fase de Em Produção (o Image Evaluator roda
   continuamente). A distinção entre "Em Produção com avaliação acontecendo" e
   "Em Revisão" é uma DECISÃO do usuário de que o trabalho principal terminou.

2. **"Pronta" não pode ser derivada sem saber o que é "essencial"**: o que define
   "todos os artefatos aprovados" depende do tipo da Produção e da definição do
   usuário do que ela precisa conter. Sem um contrato explícito do usuário, não
   há como derivar automaticamente.

### Alternativas consideradas

**A) Puramente derivado (como proposto em PRODUCTION_LIFECYCLE.md).**
Falha nos pontos acima. Seria necessário adicionar lógica de "o que é essencial
para cada tipo" no sistema de derivação, o que teria mais complexidade que os
timestamps.

**B) Máquina de estados explícita para todos os estados.**
Exagero para a escala atual. Criar transições formais para `ABERTA → EM PRODUÇÃO`
é trabalho desnecessário quando o gatilho é simplesmente "tem artefato ou não tem".

### Justificativa

Os timestamps têm uma vantagem sobre uma máquina de estados: **preservam história**.
Se a Produção passou por `review_started_at` e depois voltou para Em Produção
(porque o revisor pediu mais trabalho), o timestamp original fica como registro
histórico. Uma máquina de estados que sobrescreve o estado perde esse rastro.

### Consequências

- A tabela `productions` terá 6 colunas de timestamp (além de `created_at` e `updated_at`)
- O status é uma propriedade COMPUTADA — não existe campo `status` na tabela
- A lógica de cálculo do status é uma função pura: `computeStatus(timestamps, hasArtifacts)`
- Esta função pode ser implementada no banco (como coluna gerada) ou na camada de
  aplicação — ambas as abordagens são válidas; a decisão é de implementação

### Adiado

O comportamento exato de `PAUSADA` em relação a agentes em execução — se um
loop de geração em andamento é interrompido quando a Produção é pausada, ou
continua até o fim. Relevante na Fase B/C quando agentes rodarem de forma
mais autônoma.

---

## D4 — Produção sem Projeto

**A pergunta:** Uma Produção pode existir sem Projeto? O `PRODUCTION_LIFECYCLE.md`
diz que `project_id` é obrigatório, mas criadores sem organização por projetos
são um caso de uso real.

### Decisão recomendada

**`project_id` é sempre obrigatório. Quando o usuário não seleciona um Projeto,
o sistema usa ou cria automaticamente um "Workspace Pessoal" para o usuário.**

O "Workspace Pessoal":
- É criado automaticamente na primeira vez que o usuário precisa dele
- É nomeado "Workspace de [nome do usuário]" ou simplesmente "Meu Workspace"
- Começa sem `context`, sem `style_profile`, com `evaluation_mode: 'default'`
- É invisível na criação — não aparece como "você escolheu um Projeto"
- É visível na lista de Projetos como qualquer outro (o usuário pode editar e configurar)
- As Produções criadas "sem projeto" aparecem dentro dele

Quando o usuário não seleciona um Projeto ao criar uma Produção, a UI não pergunta —
simplesmente usa o Workspace Pessoal. O usuário pode migrar a Produção para outro
Projeto depois.

### Alternativas consideradas

**A) Permitir `project_id = null` — Produções órfãs.**
O código atual já tem `image_drafts.project_id` nullable e o `generate-feed-text`
lida com `!projectId`. Tecnicamente viável. O problema é conceitual: agentes sem
contexto de Projeto usam padrões do sistema que produzem resultados genéricos.
O usuário vê qualidade inferior sem entender por quê. Além disso, cria uma segunda
classe de Produções que tem comportamento diferente das outras.

**B) Forçar criação de Projeto antes de qualquer Produção.**
Resolve o problema de contexto mas cria atrito real para novos usuários e para
criações rápidas. "Antes de criar um post, crie um Projeto" é uma barreira de
onboarding provada como prejudicial em produtos de produtividade.

**C) Criar Projeto invisível sem que o usuário saiba.**
É o que a decisão recomendada faz, com uma nuance: o Projeto não é completamente
invisível — ele aparece na lista de Projetos sob um nome amigável. "Completamente
invisível" seria pior porque o usuário ficaria confuso sobre onde suas Produções
estão quando abrisse a lista de Projetos.

**D) Usar os defaults do sistema sem nenhum Projeto.**
Violaria o invariante do modelo: toda Produção pertence a um Projeto. Uma vez
que esse invariante existe, qualquer código de agente pode assumir que `project_id`
existe. Permitir null força verificações defensivas em toda a pipeline.

### Justificativa

O modelo de `Project` como portador de contexto é valioso demais para ser opcional.
Mas a forma como esse contexto é fornecido pode ser transparente ao usuário. O
"Workspace Pessoal" é um Projeto vazio por padrão — seus agentes usam padrões do
sistema, o que é o comportamento esperado para um usuário sem contexto de marca.

Ao longo do tempo, o usuário pode enriquecer o Workspace Pessoal com contexto,
estilo e evaluation_mode — melhorando a qualidade das Produções sem precisar criar
um Projeto formal.

### Consequências

- Na criação de conta, o Workspace Pessoal não é criado automaticamente — é criado
  **lazy** quando a primeira Produção precisa de um Projeto e nenhum foi selecionado
- A UI de criação de Produção deve mostrar "Selecione um Projeto (opcional)" —
  quando vazio, usa o Workspace Pessoal
- O Workspace Pessoal deve ser identificável no banco (ex: `is_personal_workspace: true`)
  para evitar que o usuário o delete acidentalmente
- `project_id` permanece `NOT NULL` na tabela `productions` — o invariante é garantido
  em banco, não apenas em código

### Adiado

A UI de migração de Produções entre Projetos — e se o sistema deve sugerir "Mover
para um Projeto" quando a qualidade do Workspace Pessoal for consistentemente baixa.
Isso é um insight de produto para versões futuras.

---

## D5 — Sistema de Tipos de Produção

**A pergunta:** O tipo da Produção é um enum fechado, um enum extensível, uma tabela
configurável, ou um sistema de capabilities? O que é mais simples para começar
mas extensível sem reescrever?

### Decisão recomendada

**Enum fechado de 7 tipos, com roteamento de agentes baseado em capabilities
computadas, não em strings de tipo.**

#### Os 7 tipos

| Tipo | Produções típicas |
|------|-------------------|
| `editorial` | Posts, artigos, newsletters, conteúdo de canal |
| `branding` | Identidade visual, assets de marca, logo, paleta |
| `campaign` | Campanhas de marketing, lançamentos, promocionais |
| `research` | Pesquisas, estudos, análises de mercado |
| `documentation` | Manuais, tutoriais, specs técnicas |
| `digital_product` | Landing pages, apps, produtos digitais |
| `automation` | Fluxos automatizados, integrações, n8n/Make |

`ai_project` (proposto anteriormente) é removido do enum inicial — produções de
IA são tratadas como `automation` ou `documentation` até que haja agentes
específicos para elas. Adicionar um tipo sem agentes cria expectativa não atendida.

#### Roteamento por capabilities, não por tipo

O tipo é uma label para o usuário. O que o sistema realmente usa para decidir
quais agentes rodam é um mapa de capabilities:

```
// Pseudo-código conceitual
typeCapabilities = {
  editorial:      ['planning', 'image_generation', 'copywriting'],
  branding:       ['planning', 'image_generation'],
  campaign:       ['planning', 'image_generation', 'copywriting'],
  research:       ['planning', 'research'],  // agente futuro
  documentation:  ['planning', 'documentation'],  // agente futuro
  digital_product:['planning', 'image_generation', 'copywriting'],
  automation:     ['planning', 'specification'],  // agente futuro
}
```

Quando um novo tipo for necessário, adiciona-se:
1. Um valor no enum (migration simples de `CHECK` constraint)
2. Uma entrada no `typeCapabilities` (mudança de código)

Nenhum código de agente precisa saber sobre os tipos — apenas sobre capabilities.

### Alternativas consideradas

**A) Enum menor (4-5 tipos) com "outro".**
`editorial | visual | research | other` — mais simples mas o tipo `other` recebe
roteamento genérico e degrada a experiência. "Outro" é o fim do modelo de capabilities.

**B) Tabela configurável de tipos.**
Máxima flexibilidade mas exige UI de gestão de tipos, capabilities por tipo
editáveis, validação de conflitos. Complexidade 10x maior sem benefício real para
o usuário atual. Solução para quando houver múltiplos tenants com necessidades
radicalmente diferentes.

**C) Capabilities sem tipos.**
O usuário seleciona capabilities diretamente ("quero geração de imagem + copy").
Remove a abstração amigável do tipo. Um criador de conteúdo não pensa em "preciso
de image_generation capability" — ele pensa em "vou fazer um post".

### Justificativa

O enum de 7 tipos cobre os domínios identificados na análise de domínio sem forçar
criação de tipos genéricos. O roteamento por capabilities em vez de por tipo string
é a decisão arquitetural que torna o enum extensível: adicionar um tipo não exige
tocar em nenhum agente, apenas no mapa de capabilities.

O CHECK constraint no banco (como `evaluation_mode` já faz) é simples de migrar
quando necessário. Uma migration para adicionar `'ai_project'` ao CHECK é um
arquivo SQL de 1 linha.

### Consequências

- A tabela `productions` terá `type TEXT NOT NULL CHECK (type IN (...))`
- Existe um módulo `lib/production-types.ts` (ou similar) com o mapa de capabilities
- A UI de criação de Produção mostra os 7 tipos com descrições amigáveis
- Novos agentes são adicionados ao mapa de capabilities sem alterar o schema
- O tipo pode ser alterado pelo usuário enquanto a Produção está `ABERTA`; após
  artefatos serem criados, mudança de tipo requer confirmação (pode invalidar
  workspaces ativos)

### Adiado

O mapa de capabilities detalhado por tipo — especialmente para tipos com agentes
futuros (`research`, `documentation`, `automation`). Na Fase B, a capability
`'planning'` é a única comum a todos os tipos e a única que existe de fato.

---

## D6 — Derivada vs. Artefato

**A pergunta:** O critério "esforço menor/maior que uma hora" do PRODUCTION_LIFECYCLE.md
é instável. Qual critério melhor define quando uma transformação de conteúdo deve
ser uma Produção derivada vs. um artefato da mesma Produção?

### Decisão recomendada

**Um conteúdo é uma Produção derivada quando atende a pelo menos 2 dos 4 critérios:**

#### Os 4 critérios

**1. Intenção editorial própria**
O conteúdo diz algo específico para sua audiência, não é apenas uma reformatação
do mesmo dizer. Um Reels que conta uma história diferente baseada no vídeo longo
tem intenção própria. Um Reels que é o vídeo longo em formato vertical não tem.

**2. Canal com exigências editoriais distintas**
Canais diferentes têm contratos editoriais diferentes (comprimento, tom, formato,
ritmo). Instagram e LinkedIn têm culturas diferentes — o mesmo conteúdo adaptado
para cada um exige reedição editorial, não só formatação. YouTube e YouTube Shorts
têm o mesmo conteúdo mas exigem narrativas diferentes.

**3. Ciclo de aprovação independente**
O conteúdo precisa ser revisado e aprovado separadamente, potencialmente por
stakeholders diferentes ou com critérios diferentes. Uma newsletter aprovada pelo
time de marketing e um post aprovado pelo time de redes sociais são independentes.

**4. Pode existir sem a fonte**
O conteúdo faria sentido para sua audiência mesmo que a Produção-fonte não
existisse. Uma peça de branding derivada de uma campanha pode ser usada
independentemente da campanha.

#### Teste rápido

> "Se a Produção-fonte for deletada amanhã, este conteúdo fica orphan ou
> continua fazendo sentido sozinho?"

- Continua fazendo sentido → Produção derivada
- Fica sem sentido → artefato da mesma Produção

#### Exemplos classificados

| Conteúdo | Critérios atendidos | Classificação |
|----------|--------------------|----|
| Thumbnail do vídeo | 0 de 4 | Artefato |
| Versão quadrada de imagem | 0 de 4 | Artefato |
| Story anunciando o post | Intenção própria, canal distinto | Produção derivada |
| Newsletter sobre o mesmo tema | Intenção própria, canal distinto, aprovação independente | Produção derivada |
| Carrossel adaptando o argumento do artigo | Intenção própria, canal distinto | Produção derivada |
| Reels com o mesmo conteúdo em vertical | 0 de 4 | Artefato |
| Reels com ângulo diferente inspirado no vídeo | Intenção própria | Borderline (1 critério) |

Para casos borderline com 1 critério: o usuário decide. O sistema oferece "criar
como artefato" ou "criar como Produção derivada" e o usuário escolhe.

### Alternativas consideradas

**A) Manter o critério de "uma hora".**
Problema original: uma hora é relativa à velocidade do criador, às ferramentas
disponíveis, ao nível de automação. Um sistema de IA pode executar em minutos
o que levaria horas manualmente. O critério invalida-se com mais automação.

**B) Apenas o critério "pode existir sem a fonte".**
Simples mas gera falsos positivos: uma thumbnail do vídeo pode tecnicamente
"existir" sem o vídeo (é um arquivo de imagem) mas não tem propósito independente.
O critério de "propósito independente" exigiria mais qualificação.

**C) Deixar sempre para o usuário decidir.**
Válido como fallback, mas sem orientação o usuário não sabe quando a decisão tem
consequências arquiteturais. O sistema deve guiar com critérios claros e oferecer
a decisão final ao usuário quando ambíguo.

### Justificativa

Os 4 critérios são baseados em propriedades do conteúdo que NÃO mudam com
o nível de automação ou velocidade do criador. Uma peça com intenção editorial
própria continua sendo independente mesmo que a IA a gere em segundos.

O limiar de "2 de 4" evita que critérios isolados classifiquem erroneamente.
Um canal diferente sozinho não é suficiente (YouTube e YouTube Shorts são canais
diferentes mas frequentemente o mesmo conteúdo). Uma intenção editorial própria
sozinha é suficiente na maioria dos casos, mas com 2 critérios a classificação
é mais robusta.

### Consequências

- A UI deve apresentar os 4 critérios como perguntas rápidas quando o usuário
  tenta criar um conteúdo a partir de uma Produção existente
- O campo `source_production_id` existe na tabela `productions` para rastrear
  a origem das derivadas
- O critério não é aplicado automaticamente pelo sistema — é apresentado ao usuário
  como apoio à decisão
- A documentação do `Production Architect` (futuro) deve incluir a capacidade de
  sugerir automaticamente "este conteúdo deveria ser uma Produção derivada"

### Adiado

A UI de visualização de rede de Produções derivadas (grafo de origem). Esta é
uma feature de Fase D — por ora, basta que o `source_production_id` seja
armazenado. A visualização vem depois.

---

## D7 — Regras de Aprovação Humana

**A pergunta:** O que a IA pode recomendar, aprovar autonomamente ou aprovar com
auto-mode? O que sempre requer decisão humana? Como o auto-mode funciona sem
violar o princípio de que agentes não aprovam artefatos finais?

### Decisão recomendada

**Dois níveis de aprovação distintos, explícitos e irredutíveis:**

#### Nível 1 — Aprovação técnica por IA (automatizável)

A IA pode emitir uma **aprovação técnica** quando:
- Um artefato atende ao threshold de qualidade para o `evaluation_mode` configurado
- O alinhamento entre prompt e resultado é suficiente
- Nenhuma violação de guidelines foi detectada

A aprovação técnica é representada por `ai_approved: boolean` e `ai_score: number`
nos artefatos. Ela é emitida pelo Image Evaluator (já existente no código) e,
futuramente, pelo Revisor de texto e pelo Revisor geral de Produção.

**A aprovação técnica NÃO é suficiente para nenhuma entrega.** É um sinal de
qualidade, não uma autorização de uso.

#### Nível 2 — Aprovação de entrega por humano (insubstituível)

Um humano SEMPRE aprova quando:
- Um artefato vai ser usado em qualquer contexto (selecionado, adicionado ao post,
  movido para a biblioteca)
- A Produção transita para `PRONTA`
- A Produção transita para `PUBLICADA`
- Qualquer artefato é entregue a um terceiro (cliente, plataforma)

A aprovação de entrega é representada por `approved_by: user_id` + `approved_at`
no artefato. Este campo nunca é preenchido por um processo automatizado.

#### Auto-mode: o que significa e o que não significa

O `automation_enabled` que já existe em `UserSettings` controla o **loop de
geração e avaliação**, não a aprovação de entrega.

Com `automation_enabled: true`:
- O sistema gera → avalia → refina → regera automaticamente (sem intervenção)
- O loop para quando: `ai_approved: true` OU `max_refinement_iterations` atingido
- O resultado final é apresentado ao usuário **para aprovação de entrega**
- O usuário ainda decide se vai usar o resultado

Com `automation_enabled: false`:
- O usuário aciona cada etapa manualmente
- Pode revisar o prompt antes de gerar
- Pode pedir nova avaliação após ajuste manual

Em nenhum dos dois modos a IA seleciona, usa ou entrega um artefato sem o usuário
ter acionado explicitamente.

#### O que cada agente pode fazer

| Agente | Pode recomendar | Pode aprovar tecnicamente | Pode aprovar entrega |
|--------|----------------|--------------------------|---------------------|
| Planejador de Produção | Ângulo editorial, audiência, pipeline | Não | Não |
| Prompt Generator | Prompt técnico | Não | Não |
| Image Evaluator | Score, feedback, refined prompt | Sim (ai_approved) | Nunca |
| Feed Generator | Texto pronto para revisão | Não | Não |
| Revisor | Issues, sugestões, aprovação geral | Sim (ai_approved no nível Produção) | Nunca |

### Alternativas consideradas

**A) IA aprova automaticamente quando score > threshold.**
O problema não é técnico mas de confiança e responsabilidade. Conteúdo publicado
tem consequências reais (impressões de marca, relacionamentos, regulação). A
responsabilidade por essas consequências é sempre humana. Mesmo que a IA seja
altamente precisa, o modelo mental de "eu decidi publicar isso" deve ser do usuário.

**B) Sem aprovação técnica por IA — tudo é apresentado e o usuário decide.**
Mais simples mas perde o valor do Image Evaluator existente. O score e o `ai_approved`
são informações valiosas para o usuário decidir mais rápido. Remover esse sinal
é um passo para trás em relação ao que o código atual já oferece.

**C) Auto-mode publica automaticamente quando tudo aprovado tecnicamente.**
Violação clara do princípio. Publicação é irreversível e tem consequências
que a IA não pode prever (timing de mercado, contexto político, sensibilidade
de audiência). Nenhum nível de qualidade técnica substitui o julgamento
situacional humano.

### Justificativa

O código atual já implementa a distinção implicitamente:
- `evaluate-image/route.ts` retorna `approved: boolean` (aprovação técnica da IA)
- O usuário ainda seleciona manualmente qual imagem vai para o post

A decisão formaliza e garante que esta distinção seja preservada à medida que
novos agentes e mais automação são adicionados.

A frase que resume: **"A IA aprova qualidade. O humano aprova uso."**

### Consequências

- Todos os workspaces (ImageDraft, VideoDraft, futuros) devem ter os dois campos:
  `ai_approved` (preenchido por agentes) e `approved_by / approved_at` (preenchido
  por ação humana)
- O status `PRONTA` da Produção só pode ser atingido via evento explícito do usuário
  (conforme D3), nunca automaticamente
- A UI deve deixar visualmente clara a distinção: "IA aprovou a qualidade" vs.
  "Você aprovou para uso"
- O `automation_enabled` em `UserSettings` deve ter documentação na UI explicando
  o que ele faz e o que não faz

### Adiado

O comportamento quando múltiplos usuários participam de uma Produção (equipes).
A aprovação de entrega em equipes exige definir quem tem autoridade para aprovar.
Esta questão é irrelevante para o escopo atual (usuário individual) e pertence
a uma fase futura de multi-usuário.

---

## Invariantes do Domínio

Estas são as regras que NUNCA devem ser violadas, independente de decisões
de implementação, pressão de prazo ou simplificações futuras:

**I1 — Toda Produção tem um Projeto.**
`productions.project_id` é NOT NULL. Se o usuário não escolher um Projeto,
o sistema usa ou cria o Workspace Pessoal. Não existe Produção órfã.

**I2 — O contexto flui do geral para o específico.**
Project context → Production context → local context. Camadas mais específicas
enriquecem sem apagar as mais gerais. Nenhum agente recebe apenas uma camada.

**I3 — O status da Produção nunca é inventado.**
Status é computado de timestamps reais e da presença de artefatos. Não existe
campo `status` que possa ser definido arbitrariamente.

**I4 — Agentes não entregam conteúdo.**
`approved_by` em qualquer artefato é sempre um `user_id`, nunca um `agent_id`
ou um processo automatizado. IA aprova qualidade; humano aprova uso.

**I5 — A Produção tem fim natural.**
Uma Produção que existe indefinidamente sem artefatos ou com todos os artefatos
arquivados deve ser considerada como candidata a encerramento. A Produção não
é um Projeto — ela não persiste indefinidamente.

**I6 — O tipo define capabilities, não comportamento especial.**
Nenhum código de agente faz `if (type === 'editorial')`. Agentes operam em
capabilities (`has_capability('image_generation')`). O tipo é uma conveniência
de UX, não uma ramificação de lógica de domínio.

**I7 — Produções derivadas herdam contexto, não decisões.**
Uma Produção derivada herda o `project_id` e o `source_production_id`. Não
herda `editorial_angle`, `audience` ou `evaluation_mode` automaticamente — pode
referenciá-los como ponto de partida, mas começa com sua própria intenção.

---

## O Papel do Production Architect

O "Production Architect" mencionado no contexto desta sessão é o nome conceitual
para o que está sendo chamado de "Planejador de Produção" (D1) neste documento.

O papel existe agora como um agente planejado — não está implementado, mas é
o próximo agente a ser construído na Fase C.

**O que o Production Architect / Planejador de Produção faz:**

1. **Interpreta a intenção** — transforma "criar um post sobre o lançamento do produto"
   em uma estrutura processável: tipo confirmado, audiência sugerida, canais sugeridos,
   direção editorial inicial

2. **Prepara o contexto** — constrói o `production_brief` que todos os agentes
   especializados vão consumir, combinando os contextos de Projeto e Produção segundo
   as regras de D2

3. **Sugere a pipeline** — com base no tipo e capabilities, indica quais agentes
   devem rodar e em qual ordem para este tipo de trabalho

4. **Não executa artefatos** — não gera imagens, não escreve copy, não faz pesquisa.
   Prepara o terreno para quem faz.

**O que o Production Architect NÃO é:**

- Não é um agente que decide o tipo da Produção (o usuário decide)
- Não é um planejador de projetos (não cria cronograma, não aloca recursos)
- Não é um aprovador (não aprova a própria saída nem artefatos subsequentes)
- Não é um orquestrador técnico de agentes (não controla a execução em runtime)

**Quando implementar:**

O Production Architect é um agente de **Fase C**. Para que ele seja útil, é
necessário que:
1. A entidade `Production` exista no banco (Fase B)
2. Haja pelo menos dois tipos de Produção com pipelines diferentes implementadas
3. O usuário tenha experiência com o fluxo manual de criar Produções antes de
   automatizá-lo

Implementar o Production Architect antes da Fase B criaria um agente que planeja
algo que ainda não existe. O benefício seria apenas conceitual.

---

## Resumo Executivo

| Decisão | Recomendação em uma linha |
|---------|--------------------------|
| D1 — Agente universal | "Planejador de Produção" universal; "Estrategista Editorial" é sua especialização para tipos editoriais |
| D2 — Precedência de contexto | Campos aditivos empilham; `evaluation_mode` usa override (mais específico vence) |
| D3 — Status | Híbrido: 2 estados derivados de artefatos, 6 estados por timestamps de eventos explícitos |
| D4 — Sem Projeto | Sempre há Projeto; sistema usa/cria "Workspace Pessoal" quando usuário não seleciona |
| D5 — Tipos | Enum fechado de 7 tipos; roteamento por capabilities map, não por strings de tipo |
| D6 — Derivada vs. artefato | 2 de 4 critérios: intenção própria, canal distinto, aprovação independente, pode existir sem a fonte |
| D7 — Aprovação | IA aprova qualidade (ai_approved); humano aprova uso (approved_by). Auto-mode acelera geração, não aprovação |

---

*Documento produzido na sessão de análise conceitual da Fase 2. Próximo passo:
implementar a entidade `Production` (Fase B) com base nestas decisões.*

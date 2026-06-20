# Content Agent Studio — Ciclo de Vida da Produção
**Fase 2 · Modelagem de Domínio · Junho 2026**

> Este documento modela o comportamento da entidade `Production` (Produção).
> Não descreve implementação, banco de dados, componentes ou rotas.
> Descreve como a entidade nasce, evolui, contém artefatos, interage com agentes
> e se relaciona com outras entidades do domínio.

---

## O que é uma Produção

Uma Produção é **a unidade de trabalho criativo do Content Agent Studio**.

Ela existe entre o Projeto (identidade persistente) e os workspaces especializados
(ImageDraft, VideoDraft, Post). Representa uma intenção concreta de criar algo —
com começo, meio, e fim — dentro do contexto de um Projeto.

Uma Produção responde à pergunta que nenhuma outra entidade responde:

> "O que estamos fazendo agora, por quê, e o que será entregado?"

---

## 1. Como nasce uma Produção

### O nascimento mínimo

Uma Produção nasce de **dois elementos** e apenas dois:

```
intention  →  por que este trabalho existe
project_id →  dentro de qual identidade ele acontece
```

Isso é tudo. Uma Produção pode ser criada com apenas uma frase de intenção e um
Projeto selecionado. Tudo o mais emerge do trabalho.

**Por que apenas esses dois?**

`intention` é o que diferencia uma Produção de um espaço vazio. Sem intenção, não
há trabalho — há apenas uma pasta em branco. A intenção não precisa ser elaborada:
pode ser "criar um post sobre o lançamento do produto" ou "explorar uma identidade
visual para a marca". O importante é que haja uma direção.

`project_id` é o que diferencia uma Produção de um trabalho solto. O Projeto
fornece o contexto semântico — identidade, estilo, critério de qualidade — que os
agentes precisam para trabalhar com coerência. Uma Produção sem Projeto não sabe
quem está falando.

### Campos desejáveis — mas não obrigatórios na criação

| Campo | Natureza | Quando aparece |
|-------|----------|----------------|
| `title` | Derivável da intenção | Pode ser gerado automaticamente |
| `type` | Classificação | Pode ser inferido ou escolhido depois |
| `format` | Formato de saída | Emerge conforme os artefatos são criados |
| `channel` | Canal de publicação | Relevante apenas para produções publicáveis |
| `audience` | Público-alvo | Aprofundado pelo Estrategista Editorial |
| `editorial_angle` | Ângulo escolhido | Resultado do primeiro agente editorial |
| `priority` | Urgência | Metadado de gerenciamento, não de domínio |

**Distinção importante:** `title` e `priority` são metadados de gestão — úteis para
organizar e navegar, mas não pertencem ao núcleo do domínio criativo. `intention`,
`type`, `channel`, `audience`, e `editorial_angle` pertencem ao domínio.

### O que NÃO pertence ao nascimento de uma Produção

- **Artefatos** — uma Produção nasce sem nenhum artefato. Eles são produzidos, não
  configurados.
- **Agentes** — os agentes são visitantes, não configurações.
- **Prazos e prioridades** — são metadados de gestão que podem ser adicionados
  quando relevantes, mas não definem a Produção.
- **Formato fixo** — uma Produção de tipo "editorial" não precisa saber de entrada
  se vai gerar um post, um carrossel ou um vídeo. Isso emerge do trabalho.

---

## 2. Como uma Produção evolui

### Os estados naturais

Observando o domínio sem prescrever estados artificiais, cinco estados emergem
naturalmente da progressão de qualquer trabalho criativo:

```
ABERTA → EM PRODUÇÃO → EM REVISÃO → PRONTA → ARQUIVADA
                                        ↓
                                    PUBLICADA  (opcional)
```

**Aberta**
A intenção existe. Nenhum artefato de trabalho foi criado ainda. A Produção foi
iniciada mas o trabalho não começou. É o estado de briefing, pesquisa inicial,
e definição de direção.

**Em Produção**
Pelo menos um workspace especializado (ImageDraft, VideoDraft) ou artefato de processo
foi criado. Trabalho está acontecendo ativamente. Este é o estado mais longo.

**Em Revisão**
O trabalho principal foi concluído. Artefatos existem e estão sendo avaliados —
por agentes de IA (Image Evaluator, Revisor) ou pelo próprio criador. Nenhum
artefato foi oficialmente aprovado ainda.

**Pronta**
Todos os artefatos essenciais para este tipo de Produção foram aprovados. A Produção
pode ser entregue ou publicada.

**Publicada** *(opcional)*
A entrega aconteceu. O conteúdo foi publicado, o arquivo foi enviado, o produto foi
lançado. Nem toda Produção chega a este estado — uma pesquisa interna, por exemplo,
pode ir de "Pronta" direto para "Arquivada".

**Arquivada**
A Produção está concluída e guardada como referência histórica.

### Status é derivado, não gerenciado

Este é o princípio mais importante do ciclo de vida:

> O status de uma Produção não é um campo que o usuário preenche manualmente.
> É derivado do estado dos artefatos que ela contém.

```
Se não há artefatos de trabalho  →  Aberta
Se há workspaces ativos          →  Em Produção
Se há artefatos sob avaliação    →  Em Revisão
Se todos artefatos aprovados     →  Pronta
```

Isso significa que não existe uma "máquina de estados" da Produção para manter.
A Produção é um reflexo vivo do que acontece dentro dela.

### Transições reversíveis e irreversíveis

**Reversíveis** (o trabalho criativo frequentemente retrocede):
- Em Revisão → Em Produção (quando a revisão gera mais trabalho)
- Pronta → Em Revisão (quando o criador decide reabrir a avaliação)

**Irreversíveis** (convenção social, não técnica):
- Publicada → não volta para estados anteriores
- Arquivada → encerramento definitivo (pode ser "desarquivada" apenas manualmente)

---

## 3. Artefatos de uma Produção

### A distinção fundamental

Os artefatos de uma Produção dividem-se em duas categorias que não devem ser
confundidas:

**Artefatos de processo**
Produzidos *durante* o trabalho. Descrevem a evolução da Produção. Incluem:
tentativas, avaliações, pesquisas, roteiros em rascunho, prompts intermediários.
Existem para que o trabalho possa evoluir.

**Artefatos de saída**
Produzidos *como resultado* do trabalho. São o que será entregue ou publicado.
Incluem: imagens aprovadas, textos finalizados, vídeos concluídos, documentos
publicados.

### Mapa de artefatos

| Artefato | Categoria | Quem cria | Essencial? |
|----------|-----------|-----------|------------|
| Intention | Processo | Usuário | **Sim** (é o nascimento) |
| Research notes | Processo | Usuário + Estrategista | Não |
| Editorial angle | Processo | Estrategista Editorial | Não |
| Audience definition | Processo | Estrategista Editorial | Não |
| Script / Roteiro | Processo | Roteirista + Usuário | Não |
| Prompts gerados | Processo | Prompt Generator | Não |
| Generation attempts | Processo | Image Generator | Não |
| AI Evaluations | Processo | Image Evaluator + Revisor | Não |
| Reference files | Processo | Usuário (upload) | Não |
| Imagens aprovadas | Saída | Image Generator → aprovação | Não* |
| Vídeos finalizados | Saída | Video Generator → aprovação | Não* |
| Copy / Feed text | Saída | Feed Generator → aprovação | Não* |
| Posts publicados | Saída | Usuário | Não* |
| Documentos finais | Saída | Usuário ou Agente | Não* |

*Nenhum artefato de saída é obrigatório como regra universal — o que é obrigatório
depende do tipo da Produção.

### O que torna um artefato essencial

A essencialidade de um artefato é definida pelo **tipo da Produção**, não pela
entidade em si.

- Produção editorial → imagem aprovada + copy são essenciais para declarar "Pronta"
- Produção de branding → conjunto de assets visuais aprovados é essencial
- Produção de pesquisa → documento de conclusões é essencial
- Produção de automação → especificação técnica é essencial

A regra é: **uma Produção está Pronta quando tem os artefatos de saída que seu tipo
exige**. Isso significa que o conceito de "essencial" é relativo ao tipo, não
absoluto.

---

## 4. Como os agentes interagem com uma Produção

### O modelo de colaboração

Os agentes não transformam a Produção — eles **visitam** a Produção, leem seu estado
atual, e **adicionam artefatos** a ela. A Produção é o estado compartilhado entre
todos os agentes.

```
Produção [estado compartilhado e crescente]
    │
    ├─→ Agente lê: intention + project_context + artefatos existentes
    └─→ Agente produz: novo artefato → adicionado à Produção
```

Cada agente recebe:
- O contexto do **Projeto** (identidade, estilo, evaluation_mode)
- O contexto da **Produção** (intention, editorial_angle, audience, type)
- Os **artefatos relevantes** já produzidos nesta Produção

E cada agente produz um artefato que é adicionado à Produção.

### Agentes universais

Estes agentes aparecem na maioria das Produções, independente do tipo:

**Estrategista Editorial** *(início)*
```
Lê:     intention + project_context + type + channel
Produz: editorial_angle + audience + suggested_structure
```
É o primeiro agente a rodar em uma nova Produção. Seu trabalho é transformar uma
intenção vaga em uma direção editorial precisa. Os demais agentes usam seu output
como contexto adicional.

**Revisor** *(fim)*
```
Lê:     todos os artefatos de saída da Produção + criteria
Produz: approval | issues | suggestions
```
É o último agente antes de declarar a Produção como "Pronta". Avalia o conjunto
completo — não apenas a imagem, não apenas o texto, mas a coerência do todo.

### Agentes específicos por tipo

**Para produções visuais** (editorial, branding, campanhas):
```
Produção → Estrategista → Prompt Generator → [Geração] → Image Evaluator → Revisor
```

O Prompt Generator recebe `intention + editorial_angle + style_profile + evaluationMode`
e produz um prompt técnico. O Image Evaluator recebe a imagem gerada e avalia sua
adequação ao contexto editorial — podendo iniciar um loop de refinamento antes de
declarar a imagem aprovada.

**Para produções audiovisuais** (vídeos, reels, apresentações):
```
Produção → Estrategista → Roteirista → Scene Prompt Generator → [Geração] → Revisor
```

O Roteirista recebe `intention + editorial_angle + format` e produz a estrutura de
cenas. O Scene Prompt Generator pega cada cena e produz o prompt técnico de produção.

**Para produções textuais** (newsletter, posts, documentação):
```
Produção → Estrategista → Feed Generator → Revisor
```

O Feed Generator já é consciente do canal (Instagram, YouTube, etc.) e adapta o
formato do texto conforme o destino.

**Para produções de pesquisa ou documentação:**
```
Produção → Estrategista → [Pesquisador*] → [Documentarista*] → Revisor
```
Os agentes marcados com * ainda não existem no sistema atual. A estrutura de
Produção os acomoda quando chegarem.

### O princípio do loop de refinamento

Agentes avaliativos (Image Evaluator, Revisor) podem iniciar loops:

```
Image Evaluator avalia → score baixo → produz refined_prompt
    ↓
Prompt Generator recebe refined_prompt → produz novo prompt
    ↓
[Geração] → nova imagem → Image Evaluator avalia novamente
```

O número máximo de iterações é configurado em `UserSettings.max_refinement_iterations`
(já existente no código atual). A Produção mantém o histórico de todas as iterações
como artefatos de processo (`GenerationAttempt[]`).

### O que os agentes NÃO fazem

- Agentes não decidem o tipo da Produção — isso é do usuário
- Agentes não aprovam artefatos finais — a aprovação final é sempre do usuário
- Agentes não criam outras Produções — a criação de derivadas é do usuário com apoio
- Agentes não têm memória entre Produções — cada Produção é um contexto completo

---

## 5. Como a Produção reutiliza o contexto do Projeto

### A fronteira conceitual

Esta é uma das distinções mais importantes do domínio:

| Dimensão | Projeto | Produção |
|----------|---------|----------|
| Permanência | Persistente | Transitória (tem fim) |
| Questão respondida | *Quem somos?* | *O que estamos fazendo agora?* |
| Contexto | Identidade, estilo, critério | Intenção, ângulo, audiência |
| Ciclo de vida | active / archived | aberta → arquivada |
| Granularidade | Uma marca, um cliente | Uma campanha, um post, uma pesquisa |

### O que pertence ao Projeto (e a Produção herda)

```
Project.context          → instrução permanente para todos os agentes
Project.style_profile    → direção estética que atravessa todas as produções
Project.evaluation_mode  → critério padrão de qualidade para o projeto
Project.library_files    → assets de marca disponíveis para referência
```

Esses campos pertencem ao Projeto porque **são verdadeiros para todas as Produções
dentro deste Projeto**. Mudar o `style_profile` do Projeto afeta todas as produções
futuras.

### O que pertence à Produção (e não ao Projeto)

```
Production.intention        → por que THIS trabalho existe
Production.editorial_angle  → o ângulo escolhido para ESTE conteúdo
Production.audience         → para quem ESTE conteúdo é feito
Production.channel          → para onde ESTE conteúdo vai
Production.type             → que tipo de trabalho é ESTE
```

Esses campos pertencem à Produção porque **são específicos deste trabalho** e podem
variar entre produções do mesmo Projeto. Uma campanha comercial e uma pesquisa interna
podem coexistir no mesmo Projeto com intenções e audiências completamente diferentes.

### A herança e a possibilidade de override

A Produção **herda** os valores do Projeto mas **pode sobrescrever** alguns quando
necessário.

Exemplo prático: o Projeto tem `evaluation_mode: 'conceptual'` (o padrão para este
cliente é avaliar profundidade conceitual). Mas esta Produção específica é uma
campanha de Black Friday que precisa de impacto visual imediato. A Produção pode
ter seu próprio `evaluation_mode: 'commercial'`, que os agentes usarão no lugar
do padrão do Projeto.

Isso já existe no código hoje: o `Post.ai_context` é um campo de override local
para o contexto do Projeto. A Produção formaliza e amplia esse padrão.

### Metáfora operacional

O Projeto é o **brief permanente de marca** — o manual que existe antes de qualquer
campanha e continua existindo depois. A Produção é a **ordem de serviço** — referencia
o manual, segue suas diretrizes, mas tem propósito e destino próprios.

---

## 6. Uma Produção pode gerar outras Produções

### O fenômeno da atomização

Existe um padrão reconhecível no conteúdo digital: uma peça de conteúdo substancial
é desmembrada em múltiplas peças menores para diferentes canais e formatos.

```
Vídeo longo (Produção-fonte)
    ├── YouTube Shorts (Produção derivada)
    ├── Carrossel Instagram (Produção derivada)
    ├── Newsletter (Produção derivada)
    ├── Thumbnail (artefato — não uma Produção separada)
    └── Stories (Produção derivada ou artefatos?)
```

### Quando criar uma Produção derivada vs. um artefato

A distinção é dada pelo **esforço de produção** envolvido:

**É um artefato da mesma Produção quando:**
- O trabalho é menor que uma hora
- Não exige contexto editorial próprio
- É mecanicamente derivado do original
- Exemplos: thumbnail gerada a partir do vídeo, versão quadrada de uma imagem,
  recorte de um trecho

**É uma Produção derivada (separada) quando:**
- O trabalho exige sua própria intenção editorial
- Exige agentes diferentes ou sequências diferentes
- Tem seu próprio destino e audiência potencialmente distintos
- Tem ciclo de aprovação independente
- Exemplos: Shorts que conta uma história diferente do vídeo longo, Newsletter que
  recontextualiza o conteúdo para assinantes, Carrossel que adapta o argumento para
  o formato deslizável

### O vínculo entre Produções

Quando uma Produção gera derivadas, o vínculo deve ser preservado.

```
Produção-fonte
    └── Produção derivada [source_production_id → Produção-fonte]
          └── Produção derivada [source_production_id → Produção-fonte]
```

O `source_production_id` (ou `parent_production_id`) preserva a rastreabilidade:
de onde veio a ideia, qual o contexto original, quais assets foram reutilizados.

### O que não é uma Produção derivada

Uma Produção de branding que gera posts ao longo do tempo não cria "derivadas" a
cada post — ela cria Produções independentes que compartilham o mesmo Projeto.
A diferença é que uma derivada **herda conteúdo** da Produção-fonte, não apenas
contexto. Se a relação é apenas "mesmo cliente, mesmo projeto" → Produções
independentes no mesmo Projeto. Se a relação é "este conteúdo é diretamente
baseado naquele conteúdo" → derivada.

### Implicação futura (Fase D)

Quando Produções derivadas se tornam comuns, emerge uma visão de **rede de Produções**
dentro de um Projeto — um grafo onde as produções se relacionam por origem.
Isso permite enxergar o alcance total de um conteúdo-fonte e gerenciar a consistência
entre derivadas. Este é um conceito de Fase D, não deve ser implementado antes das
Produções independentes estarem funcionando bem.

---

## 7. Validação em diferentes domínios

O teste fundamental do modelo é: a entidade `Production` continua fazendo sentido
quando o domínio muda?

### Conteúdo Editorial

```
Nasce com: "Criar post sobre o lançamento do produto X para Instagram"
Tipo: editorial
Agentes: Estrategista → Prompt Generator → Image Evaluator → Feed Generator → Revisor
Artefatos essenciais: imagem aprovada + copy para Instagram
Publicada quando: post publicado
```
**Resultado:** suportado integralmente pela arquitetura atual.

### Branding

```
Nasce com: "Desenvolver identidade visual para a linha premium da marca"
Tipo: branding
Agentes: Estrategista → (múltiplas iterações) Prompt Generator → Image Evaluator → Revisor
Artefatos essenciais: conjunto de variações visuais aprovadas
Publicada quando: assets entregues ao cliente
```
**Resultado:** suportado. Não há canal único; o critério de "Pronto" é interno ao
tipo.

### Campanhas

```
Nasce com: "Campanha de Black Friday — aumentar conversão em 20%"
Tipo: campaign
Agentes: Estrategista → Prompt Generator × n → Feed Generator × canais → Revisor
Artefatos essenciais: assets por canal + copy por canal
Gera derivadas: posts por canal se cada um tiver ciclo independente
Publicada quando: todos os assets publicados nos canais
```
**Resultado:** suportado. Campanhas são candidatas naturais a gerar Produções derivadas
por canal.

### Pesquisa

```
Nasce com: "Pesquisa sobre comportamento de consumo de conteúdo no Brasil"
Tipo: research
Agentes: Estrategista Editorial (reformulado para pesquisa) → [Pesquisador — futuro]
Artefatos essenciais: documento de conclusões
Publicada quando: pesquisa compartilhada ou publicada
```
**Resultado:** estruturalmente suportado. Precisa do agente Pesquisador (não existe
ainda). O modelo de entidade acomoda; os agentes chegam depois.

### Documentação

```
Nasce com: "Documentar o fluxo de geração de imagens para o time"
Tipo: documentation
Agentes: Estrategista → [Documentarista — futuro]
Artefatos essenciais: documento técnico finalizado
Canal: não tem (é interno)
```
**Resultado:** suportado. O campo `channel` é opcional — documentação não tem canal
de publicação obrigatório.

### Produtos Digitais

```
Nasce com: "Criar landing page para o novo produto"
Tipo: digital_product
Agentes: Estrategista → Prompt Generator (mockups/imagens) → Revisor
Artefatos essenciais: assets visuais aprovados + copy aprovado
```
**Resultado:** suportado para a fase de produção criativa. A entrega técnica (código)
está além do escopo atual dos agentes mas os assets para ela são suportados.

### Automações

```
Nasce com: "Criar automação de email para nurturing de leads"
Tipo: automation
Agentes: Estrategista → [Arquiteto de Fluxo — futuro]
Artefatos essenciais: especificação técnica + copy dos emails
```
**Resultado:** parcialmente suportado. O Feed Generator já pode criar copy de emails.
A especificação técnica exige agentes futuros.

### Projetos de IA

```
Nasce com: "Criar agente de IA para responder dúvidas de clientes"
Tipo: ai_project
Agentes: Estrategista → [Designer de Agente — futuro]
Artefatos essenciais: definição do agente + prompts de sistema + testes
```
**Resultado:** estruturalmente suportado. Prompts como artefatos já existem no
sistema. A orquestração de agentes para construir outros agentes é um conceito futuro.

---

## Síntese: o comportamento completo da Production

```
NASCE
  intention (obrigatório)
  project_id (obrigatório)
  type, channel, audience (opcionais na criação)
     ↓
ABERTA
  O Estrategista Editorial sugere ângulo e audiência
  O usuário pode pesquisar, anotar referências
  Nenhum workspace ativo ainda
     ↓
EM PRODUÇÃO
  Workspaces ativos: ImageDraft, VideoDraft
  Agentes gerando e avaliando artefatos
  Loop de refinamento acontecendo
  Múltiplas iterações armazenadas como histórico
     ↓
EM REVISÃO
  Trabalho principal concluído
  O Revisor avalia o conjunto
  Usuário revisando aprovações
     ↓
PRONTA
  Todos artefatos essenciais (definidos pelo tipo) aprovados
  Pode gerar Produções derivadas
  Pronta para entrega ou publicação
     ↓
PUBLICADA (opcional)     ARQUIVADA
  Entregue ao mundo         Concluída e guardada
  Referência futura         como referência
```

### O que a Production garante

1. **Coerência** — todos os artefatos de uma Produção compartilham o mesmo contexto
   editorial e o mesmo contexto de Projeto
2. **Rastreabilidade** — o histórico de tentativas, avaliações e decisões fica
   preservado como artefatos de processo
3. **Progressão natural** — o status emerge do estado real dos artefatos, sem
   máquina de estados artificial
4. **Extensibilidade** — novos tipos de Produção e novos agentes se encaixam no
   mesmo modelo sem modificar a entidade

### O que a Production não é

- Não é um container genérico de tarefas (não é um Kanban)
- Não é um sistema de gerenciamento de projetos (não substitui um PM)
- Não é uma sessão de trabalho (não termina quando o usuário fecha o navegador)
- Não é um template (cada Produção tem sua própria intenção)
- Não é o Projeto (não persiste indefinidamente, tem fim natural)

---

## Questões em aberto

Estas perguntas emergem da modelagem e precisam de resposta antes de qualquer
implementação da entidade `Production`:

1. **O `evaluation_mode` da Produção sobrescreve o do Projeto?** Modelagem sugere que sim.
   Mas qual é a precedência? Produção > Projeto ou Produção || Projeto.default?

2. **O tipo da Produção é um enum fechado ou extensível?** Um enum fechado é mais simples
   de implementar mas limita futuros domínios. Um sistema extensível é mais potente mas
   mais complexo.

3. **Qual o tamanho mínimo de uma Produção derivada?** A fronteira entre "artefato"
   e "Produção derivada" é um julgamento de valor que impacta a experiência de uso.

4. **A Produção tem um "dono" além do usuário?** Em contextos de equipe, quem pode
   criar, editar, aprovar? Esta questão é irrelevante agora mas impacta a modelagem
   se o produto for para times.

5. **Uma Produção pode existir sem Projeto?** A modelagem diz que não, mas existem
   casos de uso de criadores que não querem organizar por projetos. Uma Produção
   orfã (sem Projeto) violaria o modelo atual.

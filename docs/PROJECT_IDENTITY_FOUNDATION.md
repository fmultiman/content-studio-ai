# Project Identity Foundation

## Content Agent Studio

**Status:** descoberta conceitual em andamento
**Natureza:** documento de fundação de domínio
**Objetivo:** definir o que é Project Identity antes de decisões definitivas de schema, API, interface ou implementação.

---

# 1. Contexto

O Content Agent Studio começou com uma estrutura de Projetos semelhante às pastas de projeto encontradas em ferramentas de IA e criação.

Inicialmente, o Project funcionava principalmente como unidade de organização para:

* imagens;
* vídeos;
* drafts;
* arquivos;
* prompts;
* contextos;
* produções.

Com a evolução do produto, tornou-se evidente que um Project não deveria ser apenas uma pasta passiva.

O Project precisa preservar a continuidade de um trabalho ao longo de:

* diferentes Productions;
* diferentes pessoas;
* diferentes agentes;
* diferentes formatos;
* diferentes canais;
* diferentes ferramentas;
* diferentes períodos de tempo.

O Project passa, portanto, a ser a unidade persistente de identidade, contexto, memória e coerência do Content Agent Studio.

Ao mesmo tempo, o trabalho operacional concreto não deve acontecer diretamente no Project.

A fronteira consolidada é:

```text
Project
→ identidade, contexto e memória persistentes

Production
→ unidade operacional de trabalho

Artifacts
→ imagens, vídeos, conteúdos, roteiros, versões e mídias
```

O Project dá coerência às Productions.

As Productions organizam e contextualizam o trabalho concreto.

---

# 2. Pergunta central

> O que o sistema precisa saber e preservar para que um Project continue sendo reconhecido como o mesmo Project ao longo de diferentes pessoas, agentes, ferramentas, formatos e Productions?

Uma segunda pergunta complementa a primeira:

> O que deve permanecer estável no Project Identity e o que deve nascer, mudar e terminar dentro de uma Production?

---

# 3. Definição de Project Identity

**Project Identity é a representação persistente, humana e evolutiva do que torna um Project reconhecível como ele mesmo.**

Ela pode incluir:

* propósito;
* perspectiva;
* público;
* posicionamento;
* princípios;
* voz;
* linguagem;
* estética;
* limites;
* restrições;
* referências;
* critérios editoriais;
* preferências consolidadas;
* decisões aprovadas.

A Project Identity orienta:

* Productions;
* agentes;
* pesquisas;
* ideias;
* conteúdos editoriais;
* roteiros;
* imagens;
* vídeos;
* thumbnails;
* áudios;
* versões para canais;
* revisões;
* avaliações;
* pipelines automatizados.

Project Identity não é apenas informação exibida na página do Projeto.

Ela é uma camada ativa de inteligência e coerência do sistema.

---

# 4. Princípios fundamentais

## 4.1 O Project pode existir sem identidade estruturada

A criação de um Project deve permanecer simples.

Um usuário pode criar um Project apenas com:

* nome;
* descrição opcional.

O Project já pode ser utilizado como unidade de organização e pode conter Productions.

A ausência de uma identidade estruturada não torna o Project inválido.

A identidade é uma capacidade opcional e progressiva.

---

## 4.2 Criar Project não é concluir Project Identity

```text
Criar Project
≠
Estruturar Project Identity
```

A criação do Project é uma ação simples.

A estruturação da identidade é um workflow próprio que pode ocorrer:

* imediatamente;
* posteriormente;
* gradualmente;
* manualmente;
* com assistência de IA;
* por importação de materiais existentes.

---

## 4.3 A identidade é canônica, mas evolutiva

A identidade representa a verdade atualmente aprovada sobre o Project.

Ela pode evoluir, mas não deve ser modificada silenciosamente por agentes.

Fluxo desejado:

```text
IA observa
→ IA sugere
→ humano revisa
→ humano aprova
→ identidade é atualizada
```

A autoria e autoridade finais permanecem humanas.

---

## 4.4 A identidade não é toda igualmente rígida

As dimensões da identidade podem possuir diferentes políticas de herança.

### Locked

Não podem ser sobrescritas por uma Production.

Exemplos:

* princípios éticos;
* restrições legais;
* promessas proibidas;
* limites de segurança;
* regras fundamentais.

### Adaptable

São herdadas, mas podem ser interpretadas ou adaptadas pela Production.

Exemplos:

* tom;
* nível técnico;
* estética;
* linguagem visual;
* intensidade;
* ritmo;
* relação com o público.

### Default

Funcionam como preferência inicial, mas podem ser livremente substituídas.

Exemplos:

* duração;
* proporção;
* modelo de IA;
* número de cenas;
* tipo de transição;
* estrutura de roteiro.

---

## 4.5 Identidade não deve virar burocracia

Project Identity não pode se tornar um formulário obrigatório com dezenas de campos.

O sistema deve permitir enriquecimento progressivo.

Uma dimensão pode estar:

* ausente;
* em rascunho;
* parcialmente estruturada;
* aprovada;
* precisando de revisão.

Diferentes Projects podem estruturar apenas as dimensões que são relevantes para seu objetivo.

---

# 5. As sete partes da arquitetura conceitual

## 5.1 Project Folder

É a camada básica de organização.

Pode existir sem identidade estruturada.

Contém:

* nome;
* descrição;
* Productions;
* arquivos;
* referências;
* dados gerais do Project.

Sua função é permitir que o usuário comece rapidamente.

---

## 5.2 Project Identity

É a identidade persistente e canônica do Project.

Responde:

* o que este Project é;
* por que existe;
* para quem existe;
* como pensa;
* quais princípios segue;
* como se expressa;
* quais limites possui;
* o que deve permanecer coerente.

Ela está acima das Productions e dos artefatos.

---

## 5.3 Identity Builder

É o workflow opcional utilizado para construir, revisar ou reconstruir a Project Identity.

Pode operar em dois modos principais.

### Construção do zero

Para Projects novos ou sem identidade consolidada.

```text
ideia inicial
→ entrevista
→ exploração
→ propostas
→ revisão
→ identidade inicial aprovada
```

### Reconstrução de Project existente

Para Projects que já possuem materiais, histórico ou canais.

```text
materiais existentes
→ análise
→ padrões observados
→ contradições
→ proposta de identidade
→ revisão
→ identidade aprovada
```

O Identity Builder não é a própria identidade.

É o processo que ajuda a criá-la ou atualizá-la.

---

## 5.4 Production Context

É o contexto temporário de uma iniciativa concreta.

Responde:

* o que está sendo produzido agora;
* qual é o objetivo desta Production;
* qual é o tema;
* qual é o recorte;
* qual é o público específico;
* qual é o prazo;
* qual é o tom desta execução;
* quais referências são relevantes agora.

Production Context não deve alterar automaticamente a identidade canônica do Project.

---

## 5.5 Style Profile

É a dimensão expressiva canônica do Project.

Pode incluir:

* linguagem visual;
* cor;
* iluminação;
* composição;
* textura;
* símbolos;
* atmosfera;
* referências visuais;
* linguagem verbal;
* características de voz;
* elementos que devem ser evitados.

Style Profile não representa toda a Project Identity.

Ele é uma de suas dimensões.

Deve ser auditado para separar:

```text
Visual Identity
→ o que caracteriza o Project

Generation Preferences
→ como solicitar resultados aos modelos

Production Style Direction
→ como a Production adapta o estilo
```

---

## 5.6 Production Style Direction

É a direção criativa específica de uma Production.

Ela interpreta ou adapta o Style Profile do Project sem substituí-lo.

Exemplo:

```text
Project Style Profile:
simbólico, orgânico, contraste entre ancestral e tecnológico,
texturas densas e iluminação dramática.

Production Style Direction:
preservar o simbolismo, mas utilizar luz matinal,
cores naturais e atmosfera mais acolhedora.
```

A Production Style Direction pode adaptar dimensões classificadas como `adaptable`.

Ela não pode violar dimensões `locked`.

---

## 5.7 Effective Context Compiler

É a futura capacidade responsável por selecionar e combinar apenas o contexto necessário para cada agente ou tarefa.

O contexto efetivo pode ser formado por:

```text
Project Identity relevante
+ contexto geral do Project
+ Production Context
+ EditorialContent
+ Channel Contract
+ instrução específica
```

O compilador não deve enviar todo o dossiê do Project para todas as tarefas.

Exemplos:

### Geração de roteiro

Recebe:

* propósito;
* público;
* voz;
* princípios editoriais;
* restrições;
* objetivo da Production;
* mensagem do conteúdo.

### Geração de imagem

Recebe:

* identidade visual;
* referências;
* restrições visuais;
* Production Style Direction;
* intenção da peça.

### Versão para Instagram Reel

Recebe:

* essência da mensagem;
* público;
* voz;
* objetivo da Production;
* regras do formato Reel;
* CTA;
* duração e proporção.

O Effective Context Compiler será especialmente importante para pipelines automatizados.

---

# 6. As cinco zonas da Project Identity

## 6.1 Foundation

Define o fundamento do Project.

Pode conter:

* essência;
* propósito;
* razão de existência;
* visão;
* perspectiva;
* problema que busca enfrentar;
* transformação desejada;
* diferencial fundamental.

Pergunta principal:

> Por que este Project existe e o que o torna distinto?

Estabilidade típica:

```text
alta
```

Política mais comum:

```text
locked ou adaptable com alta restrição
```

---

## 6.2 Relationship

Define a relação do Project com pessoas, comunidades e contextos externos.

Pode conter:

* público principal;
* públicos secundários;
* necessidades;
* nível de conhecimento;
* relação desejada;
* posicionamento;
* percepção desejada;
* papel assumido pelo Project;
* interlocutores;
* comunidades.

Pergunta principal:

> Para quem o Project existe e qual relação deseja construir?

Estabilidade típica:

```text
média ou alta
```

Política mais comum:

```text
adaptable
```

Uma Production pode trabalhar com um recorte específico do público sem alterar o público principal do Project.

---

## 6.3 Expression

Define como o Project se manifesta.

Pode conter:

* voz;
* tom;
* linguagem;
* vocabulário;
* ritmo;
* estética;
* visual;
* áudio;
* narrativa;
* atmosfera;
* Style Profile;
* referências expressivas;
* elementos proibidos.

Pergunta principal:

> Como este Project deve parecer, soar e se comunicar?

Estabilidade típica:

```text
média
```

Política mais comum:

```text
adaptable
```

Productions podem criar variações sem romper a identidade.

---

## 6.4 Governance

Define leis, princípios e limites.

Pode conter:

* princípios;
* valores;
* limites éticos;
* restrições legais;
* políticas de segurança;
* claims proibidos;
* regras de transparência;
* temas sensíveis;
* critérios de evidência;
* condutas obrigatórias.

Pergunta principal:

> O que o Project não pode violar, mesmo quando varia formato, tom ou campanha?

Estabilidade típica:

```text
muito alta
```

Política mais comum:

```text
locked
```

---

## 6.5 Practice

Define padrões recorrentes de atuação e produção.

Pode conter:

* critérios editoriais;
* preferências narrativas;
* estruturas recorrentes;
* padrões de roteiro;
* preferências de edição;
* duração;
* uso de legendas;
* transições;
* motion graphics;
* B-roll;
* formatos recorrentes;
* critérios de qualidade;
* práticas aprovadas.

Pergunta principal:

> Como este Project costuma transformar sua identidade em trabalho concreto?

Estabilidade típica:

```text
baixa ou média
```

Política mais comum:

```text
default ou adaptable
```

---

# 7. Contexto

## 7.1 O problema do campo único

O atual campo de contexto provavelmente mistura:

* descrição geral;
* propósito;
* identidade;
* direção visual;
* regras;
* preferências;
* instruções temporárias;
* contexto de geração.

Isso foi suficiente quando o principal uso era geração de imagens.

Com Productions, conteúdos, versões, vídeos, revisores e pipelines, o campo único torna-se ambíguo.

---

## 7.2 Três camadas de contexto

### Contexto geral livre

É uma explicação narrativa do universo do Project.

Ajuda pessoas e agentes a compreenderem o cenário geral.

Pode permanecer como texto livre.

### Identidade estruturada

Define explicitamente:

* propósito;
* público;
* voz;
* princípios;
* estética;
* restrições;
* critérios.

Permite que o sistema saiba o significado de cada informação.

### Contextos especializados compilados

São recortes produzidos pelo sistema para diferentes tarefas.

Exemplos:

* Visual Context;
* Editorial Context;
* Video Context;
* Audio Context;
* Research Context;
* Review Context.

Esses contextos não precisam ser escritos manualmente como vários campos redundantes.

Podem ser derivados da Project Identity, do Production Context e da tarefa.

---

# 8. Hierarquia de contexto

A hierarquia conceitual é:

```text
Project Identity
    ↓ herança relevante

Production Context
    ↓ recorte operacional

EditorialContent
    ↓ mensagem central

ChannelPiece
    ↓ adaptação ao canal e ao formato

Artifact Instruction
    ↓ execução específica
```

Cada nível acrescenta contexto.

Os níveis inferiores não devem substituir silenciosamente as regras fundamentais dos níveis superiores.

---

# 9. Channel Contract

Canal e formato não fazem parte diretamente da Project Identity.

Eles representam regras e convenções de saída.

Exemplo:

```text
Instagram Reel
→ proporção vertical
→ curta duração
→ abertura rápida
→ linguagem adequada ao Instagram
→ CTA compatível

YouTube Video
→ duração mais extensa
→ thumbnail
→ título
→ descrição
→ estrutura de retenção
```

O contexto efetivo de uma tarefa combina:

```text
identidade do Project
+ contexto da Production
+ conteúdo
+ contrato do canal
+ instrução específica
```

---

# 10. Estados da identidade

A Project Identity pode possuir estados como:

```text
not_started
draft
in_review
approved
needs_review
archived
```

Um Project sem identidade aprovada continua funcionando.

A aprovação indica apenas que existe uma versão canônica confiável para consumo por agentes e pipelines.

---

# 11. Versionamento

A identidade pode mudar ao longo do tempo.

O sistema deve futuramente permitir registrar:

* versão;
* data;
* autor;
* motivo da mudança;
* diferenças;
* estado;
* aprovação;
* Productions que utilizaram determinada versão.

A identidade não deve ser apenas sobrescrita sem histórico.

O versionamento não precisa ser implementado integralmente na primeira versão, mas o domínio deve ser modelado sem impedir sua inclusão futura.

---

# 12. Identidade declarada e identidade observada

## Identidade declarada

É explicitamente definida e aprovada pelo usuário.

Representa a identidade canônica.

## Identidade observada

É inferida pelo sistema a partir de:

* conteúdos aprovados;
* imagens escolhidas;
* roteiros revisados;
* padrões de edição;
* rejeições;
* preferências repetidas;
* decisões humanas.

A identidade observada não altera automaticamente a identidade declarada.

Ela gera sugestões de consolidação.

```text
padrão observado
→ sugestão
→ revisão humana
→ aprovação
→ atualização da identidade
```

---

# 13. Exemplos aprovados

A identidade não vive apenas em campos de texto.

Ela também pode ser representada por artefatos aprovados:

* imagens;
* roteiros;
* vídeos;
* thumbnails;
* textos;
* prompts;
* edições;
* áudios;
* referências externas.

Um artefato aprovado pode se tornar:

* referência visual;
* referência de voz;
* referência narrativa;
* referência de ritmo;
* exemplo positivo;
* exemplo negativo.

Essas referências devem futuramente poder ser associadas a dimensões específicas da identidade.

---

# 14. Onboarding e progressive disclosure

## Criação padrão

A criação de um Project deve continuar simples:

```text
Nome
Descrição opcional
Criar Project
```

## Dentro do Project

A página pode apresentar:

```text
Identidade não estruturada

Este Project pode funcionar normalmente.
Estruture sua identidade para aumentar a coerência
entre Productions, conteúdos, imagens e vídeos.

[ Estruturar identidade ]
```

Ação secundária possível:

```text
[ Analisar materiais existentes ]
```

Não é necessário mostrar três ou quatro modalidades complexas no modal inicial.

A complexidade deve aparecer quando o usuário já entende o Project e possui motivação para enriquecê-lo.

---

# 15. Primeiro caso de uso do Identity Builder

O primeiro caso recomendado é a criação de identidade para um Project vazio.

Esse caso força o sistema a apoiar o usuário na descoberta de:

* propósito;
* público;
* posicionamento;
* voz;
* estética;
* limites;
* estratégia;
* critérios.

Depois, o sistema pode receber um segundo modo:

```text
Identity Reconstruction
```

para Projects existentes, utilizando:

* sites;
* canais;
* vídeos;
* documentos;
* textos;
* áudios;
* arquivos;
* históricos.

---

# 16. Relação entre Project e Production

Regra inicial:

> Se uma informação deve continuar verdadeira em várias Productions, ela provavelmente pertence ao Project.

> Se existe apenas por causa de uma campanha, série, vídeo, fase ou objetivo atual, provavelmente pertence à Production.

Exemplos:

| Informação                    | Project |     Production |
| ----------------------------- | ------: | -------------: |
| Propósito                     |     Sim |            Não |
| Princípios éticos             |     Sim |            Não |
| Público principal             |     Sim |            Não |
| Voz geral                     |     Sim |            Não |
| Estética-base                 |     Sim |            Não |
| Tema da série                 |     Não |            Sim |
| Público específico da série   |     Não |            Sim |
| Tom mais técnico nesta série  |     Não |            Sim |
| Direção visual desta campanha |     Não |            Sim |
| Prazo                         |     Não |            Sim |
| Thumbnail específica          |     Não | Não — Artifact |

---

# 17. Relação com pipelines

Project Identity fornece a base persistente necessária para pipelines automatizados.

Exemplo conceitual:

```text
Project Identity
+ Production Context
+ intenção do usuário
+ regras de canal
+ artefatos existentes
→ pipeline
```

Um pipeline de vídeo pode utilizar diferentes recortes da identidade em cada etapa:

```text
pesquisa
→ contexto temático e governança

roteiro
→ público, voz, critérios editoriais

direção visual
→ Style Profile e Production Style Direction

geração de imagens
→ Visual Context

edição
→ preferências de Practice

publicação
→ Channel Contract
```

Project Identity não é o pipeline.

Ela é uma das principais fontes de contexto do pipeline.

---

# 18. Decisões conceituais iniciais

1. Project pode existir sem identidade estruturada.
2. Project Identity é opcional e progressiva.
3. Criar Project não é concluir a identidade.
4. Project Identity é canônica e humana.
5. IA pode sugerir, mas não consolidar silenciosamente.
6. Style Profile pertence ao Project Identity.
7. Production recebe Style Direction, não outro Style Profile canônico.
8. Dimensões podem ser locked, adaptable ou default.
9. Contexto geral livre pode coexistir com identidade estruturada.
10. Contextos especializados devem preferencialmente ser compilados.
11. Production Context é temporário.
12. Channel Contract é uma camada distinta.
13. O primeiro Identity Builder deve suportar Project vazio.
14. Importação e reconstrução entram como modo posterior.
15. Versionamento deve ser previsto.
16. Exemplos aprovados podem fazer parte da identidade.
17. O consumo da identidade deve ser seletivo por tarefa.
18. Project Identity será base dos futuros pipelines.

---

# 19. Questões ainda abertas

1. Quais dimensões são universais para todo Project?
2. Quais dimensões devem ser opcionais?
3. O que exatamente existe hoje dentro de `context`?
4. O que exatamente existe hoje dentro de `style_profile`?
5. Quais partes do Style Profile são identidade visual?
6. Quais partes são preferências técnicas de geração?
7. Como representar políticas `locked`, `adaptable` e `default`?
8. A política pertence à dimensão ou a cada campo?
9. Como representar referências aprovadas?
10. Como representar exemplos negativos?
11. Qual é a primeira versão mínima do Identity Builder?
12. Como medir cobertura sem transformar isso em gamificação obrigatória?
13. Como agentes solicitam apenas os contextos necessários?
14. Como registrar qual versão da identidade foi usada em uma Production?
15. Como lidar com conflitos entre identidade, Production e instrução pontual?
16. Como manter Projects simples e, ao mesmo tempo, permitir profundidade?
17. Como diferentes tipos de Project alteram as dimensões relevantes?
18. Como migrar `context` e `style_profile` atuais sem perda?
19. Qual é a relação entre Project Identity e planejamento editorial?
20. Qual é a relação entre Project Identity e configurações do usuário ou organização?

---

# 20. Próxima etapa do estudo

A próxima etapa é criar o mapa detalhado das cinco zonas:

```text
Foundation
Relationship
Expression
Governance
Practice
```

Para cada dimensão, responder:

```text
nome
definição
objetivo
exemplos
universal ou opcional
estrutura ou texto livre
estabilidade
política de herança
pode variar na Production?
pode ser inferida pela IA?
exige aprovação humana?
agentes consumidores
sinais de boa definição
riscos
```

Somente depois desse mapa devem ser propostas:

* entidades;
* schema;
* migrations;
* APIs;
* interface;
* Identity Builder;
* compilação de contexto.

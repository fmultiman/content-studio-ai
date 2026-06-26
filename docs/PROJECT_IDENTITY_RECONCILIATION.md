# Projeto Identity — Auditoria de Reconciliação

**Data:** 2026-06-25
**Objetivo:** Confrontar a fundação conceitual de Project Identity com o discovery técnico e o estado atual do código após a consolidação das Produções.

---

## 1. Estado Real e Atual do Sistema

Após a consolidação (fases M10-A, M10-B e M10-C), auditamos o sistema:

### 1.1 Schema e Banco de Dados (`projects`)
Permanece inalterado em relação ao Discovery. Os campos existentes são:
* `name`
* `description`
* `context`
* `style_profile`
* `evaluation_mode`

### 1.2 Produções (Productions)
As produções agora são a **única** via operacional. No entanto, elas nascem herdando o contexto do projeto sem possuir campos próprios e maduros para `audience`, `editorial_angle` ou override do `evaluation_mode` de forma explícita na persistência final além de `intention` e `type`. 

### 1.3 Consumidores Atuais (Prompts & Agentes)
A auditoria em `lib/ai-simulator.ts` e outros geradores confirma que:
* **Prompt Generator:** Recebe integralmente `userInput`, `context`, `style_profile` e `evaluation_mode`. O modo de avaliação altera agressivamente as instruções sistêmicas.
* **Image Evaluator:** Atua como avaliador e recebe os mesmos parâmetros da identidade do Projeto (`context`, `style_profile`, `evaluation_mode`) mais a imagem e a tentativa. Ele já assume a responsabilidade de interpretar se o estilo e a intenção da identidade foram respeitados.
* **Feed Generator:** Recebe `context` e o utiliza como base informacional do projeto.

---

## 2. Reconciliação das Conclusões do Discovery

Comparamos o `PROJECT_IDENTITY_DISCOVERY.md` com o `PROJECT_IDENTITY_FOUNDATION.md`.

### 2.1 "O context é sobrecarregado e precisa ser resolvido"
**Classificação:** CONFIRMADA COM AJUSTE
* **Evidência:** O campo único mistura regras de IA, público, tom visual e textual.
* **Impacto:** O Image Evaluator e o Prompt Generator recebem textos que não dizem respeito às imagens.
* **Recomendação Atual:** A fundação aponta que a solução ideal **não** é criar colunas rígidas (`image_context`, `video_context`), mas sim evoluir para o modelo de **Effective Context Compiler**, separando a identidade canônica e derivando os contextos de execução.

### 2.2 "O style_profile mistura referências, tons e restrições"
**Classificação:** CONFIRMADA COM AJUSTE
* **Evidência:** Como array de tags livre, mistura proibições, paletas e preferências técnicas do gerador.
* **Impacto:** Diminui a aderência estética pois os modelos misturam prompts negativos com positivos.
* **Recomendação Atual:** A fundação esclarece que `style_profile` é apenas a dimensão de Expression. Restrições devem ir para Governance, preferências de geração para Practice.

### 2.3 "description vs context estão sobrepostos"
**Classificação:** SUBSTITUÍDA PELA FOUNDATION
* **Evidência:** O Discovery propôs unificar ou clarificar. 
* **Impacto:** A fundação definiu que o `description` pertence ao **Project Folder** (camada básica) e a identidade profunda pertence ao **Project Identity** (camada inteligente). Logo, não há sobreposição, são conceitos de zonas diferentes.
* **Recomendação Atual:** Manter `description` para leitura humana. A IA usará dimensões estruturadas da Identidade.

### 2.4 "evaluation_mode no Project ou na Production?"
**Classificação:** AINDA DEPENDE DE DECISÃO
* **Evidência:** A fundação afirma que uma Production possui sua própria `Production Style Direction` e pode adaptar o que é `adaptable`.
* **Impacto:** Fixar o modo apenas no Projeto impede campanhas destoantes, mas exigi-lo na Produção adiciona atrito.
* **Recomendação Atual:** Tratar como estado `Default`. O Projeto possui o default, a Produção pode realizar um override opcional.

### 2.5 "Faltam campos essenciais (audiência, restrições)"
**Classificação:** CONFIRMADA
* **Evidência:** A identidade falha sem governança e relacionamento.
* **Impacto:** Sem público, o Feed Generator produz textos genéricos. Sem restrições de governança explícitas, o gerador de imagens pode cometer erros de marca graves.
* **Recomendação Atual:** A v1 mínima deve implementar subcampos baseados na matriz de Zonas da fundação (ver documento de recomendação).

### 2.6 "Wizard ou formulário na UI?"
**Classificação:** AINDA DEPENDE DE DECISÃO
* **Evidência:** A criação do Projeto deve ser simples (Foundation princípio 4.1).
* **Impacto:** UX excessiva assusta o usuário.
* **Recomendação Atual:** Adiar a implementação do `Identity Builder` wizard. Na v1, apenas fornecer a visualização e edição limpa dos campos expandidos.

---

## 3. A Questão do "context"

Avaliamos as alternativas para resolver a sobrecarga do `context` atual:

### A. Um contexto geral livre no Project
* **Compatibilidade:** Total (é como funciona hoje).
* **Impacto UX:** Bom para o humano, péssimo para a precisão técnica.
* **Recomendação:** Rejeitada como solução única, embora a fundação defenda que "Contexto livre" continue existindo para fins de resumo humano.

### B. Vários contextos permanentes (image_context, video_context, etc.)
* **Compatibilidade:** Fácil implementação no schema, mas rígida demais.
* **Impacto UX:** Poluição visual. Obriga o usuário a preencher os mesmos dados várias vezes.
* **Recomendação:** Rejeitada pela Foundation. O canal e a formatação devem agir como um "Contract" aplicado pelo compilador, não um campo no banco.

### C. Contextos especializados compilados (Identity + Production + Tarefa = Effective Context)
* **Compatibilidade:** Excelente alinhamento com a separação em Productions.
* **Impacto UX:** Transparente. O usuário só define o que a marca é.
* **Recomendação:** **VENCEDORA.** A identidade deve descrever o domínio e deixar o compilador montar os recortes antes de entregar ao Evaluator/Generator.

---

## 4. A Questão do "style_profile"

O campo atual de `style_profile` atua como um repositório misto.

* **O que pertence ao Project (Identity canônica):** Visual Identity (paletas, referências de marca, mood), Voice/Tone (Expressão verbal).
* **O que pertence à zona Practice:** Generation Preferences (quais aspect ratios, quais flags técnicas de modelo prefere usar).
* **O que pertence à zona Governance:** Restrictions (o que a marca não pode fazer).
* **O que pertence à Production Style Direction:** A adaptação para uma campanha (ex: "estilo padrão da marca, mas com temática de halloween").

**Recomendação:** O campo string atual deve ser desmembrado nos novos blocos da zona *Expression* da identidade (separando linguagem visual e verbal).

---

## 5. Decisões Humanas Restantes

Para não gerar loops infinitos, esta é a lista restrita de decisões que o time de Produto precisa aprovar:

### DECISÃO NECESSÁRIA ANTES DO SCHEMA
1. **Evaluation Mode Overrides:** A tabela `productions` receberá a coluna `evaluation_mode` (nullable) para permitir override do Projeto na v1?
2. **Formato JSONB ou Colunas no banco:** A identidade (zonas Expression, Governance, etc.) será salva em múltiplas colunas na tabela `projects` ou empacotada em uma coluna JSONB (`identity`)?

### DECISÃO ADIÁVEL PARA UX
3. O Identity Builder será interativo (chatbot) ou apenas um formulário expandido estruturado? (Recomenda-se adiar o chatbot para v2).

### DECISÃO ADIÁVEL PARA PIPELINES
4. A implementação profunda do *Effective Context Compiler*. Na v1, podemos apenas concatenar os campos de forma estruturada nos prompts atuais do simulador/gerador sem precisar arquitetar a inteligência de seleção avançada.

### RESOLVIDA PELO MODELO ATUAL
5. "Project Identity vira burocracia na criação" — Resolvido pela Foundation. O projeto nasce vazio e opcional, a identidade é preenchida progressivamente.

---
**Status da Auditoria:** Concluída e Documentada.

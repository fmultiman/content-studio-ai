# PROVIDER_COST_ATTRIBUTION_V1 — custo estimado de OpenAI GPT Image 2 e Google Veo

Completa o cálculo e a apresentação de custo no fluxo que já existe (`provider_usage_events` → derivação **na leitura** →
Configurações → *Uso e custos*). Nenhum segundo ledger, nenhum módulo financeiro novo, nenhuma chamada paga: toda a validação
foi offline (PGlite + mocks) e por `SELECT` de leitura no ledger de Produção.

> **Preço de tabela não é fatura.** Tudo que aparece aqui é uma **estimativa pelo preço público de tabela** do provedor. Com chave
> própria (BYOK) a fatura real da conta do usuário pode ser diferente. Nenhum campo de "valor cobrado" é preenchido: a tela
> diz "Valor cobrado não disponível".

## 1. Arquitetura reaproveitada

| Peça existente | Papel aqui |
|---|---|
| `provider_usage_events` (044) | **fatos** de consumo, intocados. Nenhuma linha é criada, alterada ou duplicada por esta entrega. |
| `provider_pricing_versions` (061, 062, FUTURE-064 Slice D) | **única autoridade de preços**: versionada, com janela `[effective_from, effective_to)`, fonte, data de consulta e base da data. |
| `lib/usage/pricing/derive.ts` | **única derivação**: `consumo × versão de preço vigente em occurred_at`. Ganhou: planos OpenAI Images por modalidade, plano Veo por segundo × resolução, e o estado `simulated`. |
| `lib/usage/pricing/aggregate.ts` / `presentation.ts` | soma exata (BigInt), cobertura e linguagem de produto. |
| `GET /api/settings/usage` | já derivava na leitura, com a **sessão do usuário** (RLS é a fronteira de tenant). Sem mudança de código. |
| `components/settings/usage-history.tsx` | mesma tela; filtros e resumos preservados. |

## 2. Tabela final de preços (USD, observados em 2026-10-14, base `observed_at_source`)

**OpenAI `gpt-image-2` — Images API, processamento Standard** — <https://developers.openai.com/api/docs/pricing>, por 1 milhão de tokens:

| Categoria | USD / 1M | Observação |
|---|---|---|
| `input` (texto) | 5,00 | |
| `image_input` | 8,00 | **categoria nova**; tokens de imagem estão *incluídos* no agregado `input_tokens` |
| `image_output` | 30,00 | |

Não gravados de propósito: **Batch** (2,50 / 4,00 / 15,00 — outra superfície de API), **cached input** (1,25 / 2,00 — a própria página diz que só
vale para imagens geradas pela Responses API; o Content Studio usa `images/edits`) e **saída de texto** (o GPT Image 2 não publica preço).

**Google Veo 3.1 — tier pago, vídeo com áudio, USD por segundo gerado** — <https://ai.google.dev/gemini-api/docs/pricing>:

| Modelo (ID real) | 720p | 1080p | 4k |
|---|---|---|---|
| Standard `veo-3.1-generate-preview` | 0,40 | 0,40 | 0,60 |
| Fast `veo-3.1-fast-generate-preview` | 0,10 | 0,12 | 0,30 |
| Lite `veo-3.1-lite-generate-preview` | 0,05 | 0,08 | *não suportado — sem linha* |

Categorias novas: `video_second_720p`, `video_second_1080p`, `video_second_4k` (o preço depende de resolução; a chave
`provider, model, categoria, tier` do registro não muda). A página nota que só há cobrança quando o vídeo é gerado — o ledger só tem
linha para vídeo entregue.

## 3. Origem e confiabilidade (cinco coisas diferentes)

| O quê | Como aparece |
|---|---|
| Quantidade **informada pelo provedor** | "Medição: informado pelo provedor" (OpenAI tokens, Kling units quando o provedor declara) |
| Quantidade **derivada** pelo Content Studio | "Medição: derivado (não medido pelo provedor)" — **só** os segundos do Veo (duração do pedido entregue). É a única exceção auditada à regra "só `provider_reported` é precificado"; a estimativa traz a ressalva `usage_derived_from_request`. Qualquer outro `derived`/`estimated`/`balance_delta` continua sem preço. |
| Consumo **desconhecido** | "Uso não informado" + "Consumo desconhecido" + "Preço indisponível". Nunca zero. |
| Custo **estimado** por tabela pública | "Custo estimado: US$ x" com fonte, "em vigor desde", "consultado em", nível de serviço e critério (tooltip). |
| Custo **real confirmado** | **Não existe** neste produto: "Valor cobrado não disponível". |

**Simulação a preço atual.** As tabelas só começam no dia em que o preço foi *observado* na página oficial (nenhuma tem histórico;
nada é retroagido). Uma execução **anterior** à primeira versão de preço **não recebe estimativa do período**: para OpenAI Images e
Veo ela aparece como **"Simulação a preço atual"** (status `simulated`), com o preço conhecido mais antigo, **fora** do total
estimado e declarada à parte. Os preços já aprovados antes desta entrega (Gemini texto/Review/imagem, OpenAI Chat, Kling units)
**mantêm a regra estrita** (anterior à primeira tabela = "indisponível"): nenhum número histórico existente mudou (a matriz dourada
`legacy-cost-regression` continua idêntica). Ampliar a simulação a esses casos é decisão do proprietário.

## 4. Como cada linha é calculada

* **OpenAI Images** — o ledger tem duas linhas por tentativa: `input_tokens` (1054) e `output_tokens` (1756). Cada agregado é dividido com o
  detalhe **da mesma resposta** (`inputTextTokens` + `inputImageTokens`; `outputImageTokens` + `outputTextTokens`) e a soma precisa **fechar
  exatamente** com o agregado — senão `inconsistent_usage`. Sem detalhe → "modalidade não informada". Saída de texto > 0 → sem preço
  (`no_pricing_for_category`), nunca emprestando outra tarifa. O tier não é informado pela resposta: usa-se Standard **somente** enquanto o registro
  só tiver Standard para o modelo (mesma regra do Gemini Image).
* **Veo** — `segundos derivados × preço(modelo, resolução)`. A resolução e a duração vêm de `provider_metadata.request` (o que foi enviado). Duração do ledger ≠ duração
  registrada → `inconsistent_usage`; resolução ausente/desconhecida → `resolution_unknown`; Lite em 4k → sem linha → indisponível.
* **Kling** — inalterado e **separado**: `units` com `provider_reported` seguem o preço público de lista (US$ 0,14/unidade) com a ressalva de que o preço real
  depende do pacote da conta; `credits` do MCP não têm conversão para USD; quantidades em unidades diferentes nunca são somadas.

## 5. Validação dos canários históricos (leitura, sem reexecutar provedor)

OpenAI GPT Image 2 I2I (2026-10-13 17:20 UTC, `provider_usage_events` reais):

| Linha | Cálculo | USD |
|---|---|---|
| input texto | 30 × 5,00 / 1M | 0,000150 |
| input imagem | 1024 × 8,00 / 1M | 0,008192 |
| output imagem | 1756 × 30,00 / 1M | 0,052680 |
| **Total** | | **0,061022** |

Como a execução (13/10) é anterior à primeira versão (14/10), os dois registros aparecem como **simulação a preço atual**
(0,008342 + 0,05268), não como estimativa do período.

Google Veo Fast 720p (2026-10-14, derivados): T2V 4 s = **0,40**, I2V 4 s = **0,40**, A+B 8 s = **0,80** — total estimado **US$ 1,60**
(as três execuções ocorreram no dia da observação do preço).

Kling REST A+B (task `939292108199575614`): o provedor **não informou `billing` válido**. O consumo continua **desconhecido**; 3 units **não** são
assumidas, e nenhum USD é inventado (não se conhece o preço do pacote da conta). Cobertura exibida:
`US$ 1,60 estimados + US$ 0,061 simulados a preço atual (2 registros anteriores à tabela) + 1 registro sem precificação`.

## 6. Interface

Mesma tela *Uso e custos*. Por linha: provedor, conexão, modelo, operação, quantidade na unidade nativa, origem da medição, e um dos estados
**Custo estimado** / **Simulação a preço atual** / **Preço indisponível** (+ **Consumo desconhecido** quando o provedor não informou o uso). O resumo
mantém "Resumo por unidade" e mostra o custo com **cobertura**: título "Custo estimado parcial" sempre que houver linha sem preço ou simulada,
o total só das linhas estimadas, a simulação à parte, a contagem de linhas sem precificação ("não entram no total e não valem zero") e a linha
"Cobertura: …". Filtros (período, provedor, conexão, projeto) recalculam tudo.

Não foi feito redesign nem enriquecimento do histórico de gerações (cards de Vídeo/Imagem): isso exigiria alterar rotas do caminho de geração paga,
fora do escopo ("Ausência de alteração na geração paga"). A tela de uso é a fonte única.

## 7. Persistência e migração

Mecanismo existente (registro versionado); **sem tabela nova, sem coluna nova, sem mudança no ledger**. Há uma migração **de dados + 1 CHECK**,
preparada, revisada, **NÃO APLICADA**:

* `docs/productization/sql/PROVIDER_COST_ATTRIBUTION_V1_openai_image_veo_pricing.up.sql` — alarga o `CHECK (usage_category …)`
  (`image_input`, `video_second_720p/1080p/4k`) e insere **11 linhas** (3 OpenAI + 8 Veo). Uma transação, `lock_timeout`, guarda que recusa estado
  divergente (inclusive Produção sem a Slice D), verificação final, idempotente. Reversível por `…down.sql` (recusa apagar histórico editado).
* Provada localmente em PGlite com formato de Produção (61 + 62 + Slice D): 28 → 39 linhas; digest das 28 existentes idêntico; reaplicação sem efeito;
  rollback restaura exatamente; guardas e falha tardia abortam sem alterar nada.

**Dependência.** O código é seguro **antes** do SQL (os modelos aparecem como "Preço indisponível", `no_pricing_for_model`) e o código **antigo** é seguro **com** o
SQL (`toPricingVersion` descarta categoria desconhecida). Os valores em US$ só aparecem depois que o operador aplicar o SQL, o que exige autorização específica do proprietário.

## 8. Limitações reais

* Valores em US$ de GPT Image 2 e Veo dependem da aplicação do SQL em Produção (pendente de autorização).
* O preço vale a partir do **dia observado** (14/10/2026); as páginas não publicam histórico. O canário OpenAI de 13/10 só pode ser mostrado como simulação.
* Estimativa de tabela ≠ fatura; free tier, créditos e termos negociados não são representados.
* Segundos do Veo são **derivados** do pedido, não medidos; o Google não devolve uso.
* Kling: sem `billing` válido não há consumo nem USD; o preço real da unidade depende do pacote da conta (o mapeamento 1 unidade = US$ 0,14 é o de lista).
* A tela lê as 200 execuções mais recentes (limite já existente).
* Sem cobertura de custo no histórico de gerações dos workspaces (ver seção 6).

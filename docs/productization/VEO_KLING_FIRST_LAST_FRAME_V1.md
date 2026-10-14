# VEO_KLING_FIRST_LAST_FRAME_V1 — Google Veo + primeiro/último quadro no /videos

Entrega B. Integra o Google Veo (API oficial Gemini, chave BYOK do usuário) ao workspace `/videos` e adiciona a criação de
vídeo com **imagem inicial A (obrigatória)**, **imagem final B (opcional)** e um prompt de movimento/transição — nos
modelos Veo e nos modelos Kling que realmente aceitam dois quadros. Nada aqui executa geração paga: todo teste de provedor
usa mocks, e o Veo é entregue **desligado** (ver "Liberação").

> **Primeiro/último quadro ≠ imagens de referência.** Primeiro e último quadro *definem o início e o fim* do clipe.
> "Reference Images" (Veo) / "image_1..image_7" (Kling Omni/O1) orientam identidade, aparência ou estilo. São capacidades
> diferentes. Este produto oferece **apenas** primeiro/último quadro; referências estão ADIADAS (seção 9).

## 1. Contratos dos provedores (evidência)

| Provedor | Fonte | O que foi confirmado |
|---|---|---|
| Google Veo | `ai.google.dev/gemini-api/docs/veo` e `/pricing` (consultadas em 2026-10-13) | Modelos `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview` (todos *preview*). `POST /v1beta/models/{id}:predictLongRunning` com `instances[0] = { prompt, image?, lastFrame? }` (`lastFrame` só junto de `image`) e `parameters`. Duração 4/6/8 s; 1080p e 4k exigem 8 s; 16:9 ou 9:16; 720p/1080p/4k (Lite: sem 4k). Áudio nativo sempre ligado. Operação assíncrona: `GET /v1beta/{operation.name}` → `done`, `response.generateVideoResponse.generatedSamples[0].video.uri`; download com o mesmo `x-goog-api-key`. Vídeo retido 2 dias. Gerações bloqueadas por segurança não são cobradas. Sem camada gratuita. |
| Kling REST 3.0 | Documentação oficial (trecho) do endpoint `POST /image-to-video/kling-3.0` | `contents[]` com itens `first_frame` e `last_frame`; *last-frame-only* não é suportado. |
| Kling REST 2.6 | Contrato do próprio modelo, reportado pelo servidor MCP da Kling (`who_am_i`, mcpVersion 1.3.3) + espelhos da API legada | `image` + `image_tail`; "Tail image requires 1080p"; áudio "not supported with a tail image". |
| Kling MCP | `who_am_i` real da conta do proprietário (2026-10-13, somente leitura, sem custo) | Entrada **opcional** `tail_image` (URL de `file_upload`) em `kling-video-v2_5`, `kling-video-v2_6` e `kling-video-v3_0`. **Não** existe em `kling-video-v3_0_turbo`; `kling-video-o1` e `kling-video-v3_0_omni` usam `image_1..image_7` (referências). |

Pontos que a documentação **não** fecha e só o canário pago confirma (ver seção 10): formato exato de `image`/`lastFrame`
(`inlineData` conforme a página do Veo; algumas APIs Google aceitam `bytesBase64Encoded`), tipo de `durationSeconds`
(número enviado), e se o Kling 3.0 REST aceita `last_frame` com `multi_shot` ligado (por isso fica desligado).

## 2. Modelos com A + B realmente habilitados

| Conexão | Modelo | A + B | Regras com B |
|---|---|---|---|
| **Kling API (REST)** | Kling 3.0 (`kling-v3`) | sim | multi-shot **desligado** |
| | Kling 2.6 (`kling-v2-6`) | sim | **1080p obrigatório**; áudio **desligado** |
| **Kling conta (MCP)** | só modelos cujo `who_am_i` da *própria conexão* declara `tail_image`: hoje `kling-video-v2_5`, `kling-video-v2_6`, `kling-video-v3_0` | sim | v2_6: 1080p + sem áudio (lido do texto do argumento); v3_0: multi-shot desligado |
| | `kling-video-v3_0_turbo`, `kling-video-o1`, `kling-video-v3_0_omni` | **não** | recusado com motivo; nunca enviado sem B |
| **Google Veo** | Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite | sim | **8 s** (conservador, UI e servidor — ver "Verificação pré-canário"); além das gerais (1080p/4k = 8 s) |

A habilitação **não** usa lista global nem o nome comercial: vem do contrato efetivo (código para REST/Veo; `tail_image` da
conexão para MCP). Um snapshot MCP salvo *antes* desta entrega não tem a capacidade e só passa a oferecê-la depois de
"Atualizar conexão" — comportamento deliberado (nenhuma conexão antiga é bloqueada).

## 3. Diferenças entre Kling REST, Kling MCP e Google Veo

| | Kling REST | Kling MCP | Google Veo |
|---|---|---|---|
| Credencial | chave Kling (BYOK) | OAuth da conta Kling | chave Gemini (BYOK) |
| Entrega das imagens | **URLs pré-assinadas** (S3 privado, curta duração) | **bytes** → `file_upload` do provedor (as duas imagens sobem *antes* da ferramenta paga) → URLs do provedor em `first_image`/`tail_image` | **bytes inline** em `inlineData` (≤ 7 MB por imagem; PNG/JPEG) |
| B no payload | `last_frame` (3.0) · `image_tail` (2.6) | `tail_image` | `lastFrame` |
| Conclusão | callback assinado (HMAC) + `/sync` | poller (VPS) + `/sync` | poller (VPS) + `/sync`; chave do dono resolvida no servidor (`status_read`) |
| Resultado | URL temporária → copiada para S3 privado | idem | URI Google (2 dias) → copiada para S3 privado com o header da chave **apenas no host de origem** |
| Uso registrado | desconhecido (Kling não informa) | desconhecido | **derivado**: duração solicitada em segundos (`measurement_source=derived`), só quando o vídeo foi entregue |
| Áudio | controle | controle (+ ASMR/prompts avançados) | sempre nativo, sem controle |

## 4. Combinações de parâmetros permitidas

* **Todas as conexões**: `lastFrame` só em `image_to_video`; nunca em texto → vídeo. B ≠ A (mesma imagem é recusada).
* **Kling 2.6 + B**: resolução 1080p, áudio `off`. **Kling 3.0 / MCP v3_0 + B**: multi-shot `off`.
* **Veo**: `durationSeconds ∈ {4, 6, 8}`; **com imagem final B, apenas 8 s** (`LAST_FRAME_DURATION_CONFLICT`; 4/6 s seguem válidos para uma imagem e para texto); `1080p`/`4k` ⇒ 8 s (a UI e o servidor concordam; ao escolher 1080p/4k a duração vai para 8 s e a nota explica); `4k` não existe no Lite; `aspectRatio ∈ {16:9, 9:16}` também com imagem; um vídeo por pedido.
* Não oferecidos mesmo existindo no provedor: extensão, imagens de referência, seed, prompt negativo, `personGeneration` (valor padrão do provedor), 4K no Lite, vários vídeos por pedido.

## 5. Fluxo de UI (Imagem para Vídeo)

```
[Imagem inicial (A)]          Escolher / Trocar / Remover   (obrigatória; miniatura + origem)
[Imagem final (B) — opcional] Adicionar / Trocar / Remover  (miniatura; nota se o modelo não a aceita)
[Prompt de movimento e transição]   (rótulo muda quando B existe)
[Modelo / Duração / Resolução / Proporção / Áudio]  → [Gerar vídeo]
```

* Reaproveita o seletor existente (Geradas por IA / Galeria / Arquivos / Enviar) para A e para B.
* Texto → Vídeo não mostra nenhum seletor de quadro. A nota "Primeiro e último quadro definem o início e o fim… não são imagens de referência" fica sempre visível.
* **Troca de modelo/resolução com B escolhida**: B e o rascunho são preservados; a incompatibilidade aparece junto do seletor de B (`role="alert"`) e **o envio fica bloqueado** até o usuário ajustar explicitamente (ou remover B). Nada é descartado nem alterado em silêncio, e o servidor recusa o mesmo caso (`UNSUPPORTED_LAST_FRAME`, `LAST_FRAME_*_CONFLICT`).
* Opções derivam das capacidades efetivas da conexão/modelo/operação (`VideoModelCapability.lastFrame`, `durationsByResolution`, `nativeAudio`).
* Modos Manual / Assistido / Automático inalterados. O assistente de texto **não recebe imagens** e a instrução agora diz isso também para A+B (nunca afirma tê-las visto). O Automático continua limitado a uma assistência + um envio autorizado; nenhum Review automático.

## 6. Persistência, idempotência e recuperação

* **Sem migração.** A é `source_image_id` | `source_library_file_id` (colunas existentes; o `CHECK` XOR continua valendo). B vive em duas camadas JSON já existentes:
  * Attempt (imutável): `video_generations.request_config.first_frame` / `last_frame` = `{ type: 'generated'|'library', id }` — **apenas ids duráveis**, nunca URL, caminho ou assinatura. Só attempts *com* B gravam o par, então um I2V de uma imagem continua byte a byte igual.
  * Session: `working_config.lastFrame` (campo opcional do working state; omitido quando vazio, então Sessions antigas mantêm o JSON e o fingerprint). Autosave/CAS/recuperação são os existentes.
* **Fingerprint de idempotência** inclui `lastFrameImageId`/`lastFrameLibraryFileId` — acrescentados **somente quando presentes**, logo o fingerprint de todo pedido sem B é idêntico ao anterior. Mesma chave com B diferente (ou B removida) = `409 IDEMPOTENCY_KEY_REUSED`; mesma chave e mesmo pedido = replay sem nova chamada paga.
* **Resultado incerto** (rede, timeout, 5xx, 2xx ilegível): Veo → attempt `failed` com `outcome_unknown: true`, resposta `502 SUBMIT_OUTCOME_UNKNOWN`, **nunca reenviado automaticamente**; recusa 4xx → `outcome_unknown: false`. O cliente mantém o `clientRequestId` pendente (comportamento existente).
* **Histórico/Reutilizar configurações** restauram A, B, modelo e conexão (inclusive `google:gemini`). O card do histórico mostra a proveniência "primeiro e último quadro".
* **Autorização**: A e B passam pela *mesma* cadeia de confiança (dono + Project + tipo imagem + não-excluída + chave de storage do próprio dono). Id de outro usuário/Project ⇒ "não encontrado", sem registro e sem chamada ao provedor. Mídia continua privada (S3 privado; Veo/MCP recebem bytes, REST recebe URL pré-assinada de curta duração; o vídeo final só é servido por URL pré-assinada).

## 7. Resultado

Reprodução, download, histórico, S3 privado durável, "Salvar em Arquivos", elegibilidade para Video Review (o contexto lê `provider`/`model` genericamente) e hand-off ao Creative Editor Video funcionam para vídeos Veo pelos mesmos caminhos do Kling — esses consumidores não dependem do provedor.

## 8. Custos

Veo cobra por segundo gerado e a resposta não traz quantidade. O ledger grava **1 evento por vídeo entregue** com `quantity = duração solicitada`, `unit = seconds`, `measurement_source = derived` (nunca `provider_reported`); falha/bloqueio de segurança ⇒ nenhum evento (o Google não cobra). **Custo estimado: indisponível** até existirem linhas de preço (nenhuma foi inserida; sem migração em Production). Preços de lista a registrar numa migração revisada **(não aplicada)**, USD por segundo, com áudio, camada paga, fonte `ai.google.dev/gemini-api/docs/pricing`:

| Modelo | 720p | 1080p | 4K |
|---|---|---|---|
| `veo-3.1-generate-preview` | 0,40 | 0,40 | 0,60 |
| `veo-3.1-fast-generate-preview` | 0,10 | 0,12 | 0,30 |
| `veo-3.1-lite-generate-preview` | 0,05 | 0,08 | — |

Kling continua com uso desconhecido (nenhum transporte informa). Custos conhecidos/parciais/desconhecidos mantêm a semântica existente: desconhecido ≠ 0.

## 9. Outros recursos Kling — IMPLEMENTADO / DISPONÍVEL / ADIADO

| Recurso | Estado | Justificativa |
|---|---|---|
| Controles avançados MCP (ASMR, prompt de áudio/música), áudio, multi-shot | **IMPLEMENTADO** (mantidos) | inalterados |
| Primeiro/último quadro (REST 3.0/2.6, MCP com `tail_image`, Veo) | **IMPLEMENTADO** | esta entrega |
| Motion Control | **DISPONÍVEL** (ferramenta `motion_control` existe na conta) | fluxo próprio (vídeo de referência + imagem); fora do escopo |
| Elements (`element_create/list/get/update/delete`) | **DISPONÍVEL** | exige gestão de sujeitos reutilizáveis |
| Omni / multi-reference (`kling-video-o1`, `kling-video-v3_0_omni`, `omni_ref_video`) | **DISPONÍVEL** | referências ≠ primeiro/último quadro; contrato `image_1..7`; deliberadamente fora do normalizador |
| Kling 3.0 Turbo + B | **ADIADO** | o modelo não declara `tail_image` |
| Lip Sync | **ADIADO** | nenhuma ferramenta correspondente na conta; sem contrato REST integrado |
| Múltiplas saídas (`imageCount > 1`) | **ADIADO** | o produto fixa 1 ação → 1 vídeo → 1 cobrança |
| Extensão/Imagens de referência do Veo | **ADIADO** | capacidades distintas de primeiro/último quadro |

## 10. Liberação e canários pagos necessários

* **O Veo é entregue DESLIGADO** (`CONTENT_STUDIO_VEO_VIDEO_GENERATION`, valor exato `enabled`, como o interruptor do Gemini Image): a conexão aparece, os controles são visíveis e explicados, mas `canGenerate=false` (`FEATURE_DISABLED`, 403) até o operador ligá-lo **depois** do canário autorizado. O guard FUTURE-050 (Production-only) vale em adição.
* Canários pagos que ainda são necessários (cada um exige autorização explícita do proprietário):
  1. **Veo texto → vídeo** (Fast, 720p, 4 s — o mais barato) para validar o contrato de `predictLongRunning`, o formato de `durationSeconds`, polling, download com header e o evento derivado.
  2. **Veo A + B** (Fast, 720p, 4 s): `inlineData` para `image`/`lastFrame` (ver ressalva da seção 1).
  3. **Kling REST 3.0 A + B** (`last_frame`) e **Kling 2.6 A + B** (`image_tail`, 1080p, sem áudio).
  4. **Kling MCP A + B** (`tail_image` via `file_upload`), de preferência `kling-video-v2_6` ou `v3_0`.
  5. Só então ligar `CONTENT_STUDIO_VEO_VIDEO_GENERATION` em Production e, se desejado, aplicar a migração de preços.

## 10b. Verificação pré-canário do adapter REST Veo (2026-10-13, documentação Google atualizada em 2026-10-08)

| Item | Documentação oficial | Adapter | Resultado |
|---|---|---|---|
| Endpoint | `POST …/v1beta/{model=models/*}:predictLongRunning`; `instances[]`/`parameters` são `google.protobuf.Value` (referência da API) | idem | igual |
| Corpo | `instances[0]` = `{ prompt, image, lastFrame }` e `parameters` irmão (exemplo REST de first/last frame) | idem | igual |
| `image` / `lastFrame` | `{ "inlineData": { "mimeType": "image/png", "data": <base64> } }`; nenhum exemplo REST usa `bytesBase64Encoded` ou `mime_type` | idem (teste fixa as chaves) | igual |
| `aspectRatio` / `resolution` | strings (`"9:16"`, `"4k"` em `parameters`) | strings | igual |
| `durationSeconds` | **nunca aparece em um corpo REST**; a tabela lista `"4"`, `"6"`, `"8"` sem declarar tipo | número JSON | **única incerteza do contrato** — confirmar no canário (campo inteiro; um `Value` numérico é o formato padrão) |
| `numberOfVideos` | aparece só no exemplo REST de extensão; os SDKs usam outro nome (`sampleCount`) | **não enviado** (padrão = 1 vídeo por pedido) | removido após o primeiro canário (Google recusou o pedido T2V com HTTP 4xx; o parâmetro era o principal suspeito) |
| A+B exige 8 s? | **não declarado** (a tabela só exige 8 s para extensão, imagens de referência, 1080p e 4k); revisões anteriores exigiam 8 s na interpolação | **restrito a 8 s** | dúvida ⇒ restrição conservadora (UI + servidor), reversível após o canário |
| `personGeneration` | `allow_all` (texto) / `allow_adult` (imagem/interpolação) | **não enviado** (padrão do provedor) | confirmar no canário A+B |
| Operação | `jq -r .name` do POST; `GET ${BASE_URL}/${operation_name}` com `x-goog-api-key`; `done == true` | `GET …/v1beta/{name}`; `name` aceito com ou sem o prefixo `models/{model}/` (nunca outro caminho) | igual (+ tolerância) |
| URI do vídeo | `.response.generateVideoResponse.generatedSamples[0].video.uri` | idem (+ forma `generatedVideos` do SDK) | igual |
| Download | `curl -L -H "x-goog-api-key: …" "${video_uri}"` | GET fixado ao IP vetado, redirects manuais; o header só vai ao host de origem; host fixo `generativelanguage.googleapis.com` | igual (mais restrito) |
| Bloqueio de segurança | "bloqueado ⇒ não cobrado"; campos de filtro não documentados | sem vídeo ⇒ `failed`, `raiMediaFilteredCount>0` ⇒ `PROVIDER_CONTENT_FILTERED`; nenhum evento de uso | consistente |
| Retenção | 2 dias | o poller copia para S3 em minutos; falha por até 23 h | consistente |

### Canário controlado (o interruptor é GLOBAL)

`CONTENT_STUDIO_VEO_VIDEO_GENERATION=enabled` vale para **toda a implantação**: sozinho, habilita o Veo para **qualquer usuário que tenha uma chave Gemini**. Para um canário que só alcance o proprietário:

1. Defina **primeiro** `CONTENT_STUDIO_VEO_CANARY_USER_IDS=<uuid do proprietário>` (lista separada por vírgulas; o uuid é `auth.users.id`). Com a lista definida, o Veo fica habilitado **somente** para esses ids e um chamador não identificado é recusado (fail closed). A lista sozinha não habilita nada.
2. Só então defina `CONTENT_STUDIO_VEO_VIDEO_GENERATION=enabled` e faça o redeploy de Production (variáveis são lidas no runtime da implantação).
3. Confirme em `/api/video-generations/connections` que `google:gemini` tem `canGenerate: true` para o proprietário (e `feature_disabled` para qualquer outra conta).
4. Execute o canário; depois **desfaça** (remova o interruptor) ou mantenha a lista até a liberação geral. Para liberar a todos, remova `CONTENT_STUDIO_VEO_CANARY_USER_IDS` e mantenha o interruptor.
5. Preview, local e ambientes desconhecidos continuam bloqueados pelo guard FUTURE-050, com ou sem as variáveis.

**Disponibilidade geral (go-live).** Decisão do proprietário: o Veo é um provedor normal. Com `CONTENT_STUDIO_VEO_VIDEO_GENERATION=enabled` e **sem** `CONTENT_STUDIO_VEO_CANARY_USER_IDS`, qualquer usuário autenticado com a **sua** conexão Gemini BYOK válida pode gerar (isolamento entre contas, autenticação e o guard FUTURE-050 continuam). A allowlist é opcional: só restringe quando definida explicitamente.

**Diagnóstico.** `GET /api/video-generations/connections` informa o motivo por conta, sem expor variáveis: `feature_disabled` (interruptor ausente/valor incorreto), `canary_restricted` (interruptor ligado, mas uma allowlist explícita não inclui a conta) ou `not_configured` (sem chave Gemini). O valor do interruptor é comparado após remover espaços e um par de aspas (`enabled`, ` enabled
`, `"enabled"` valem); `true`, `1`, `ENABLED` continuam recusados.

## 11. Testes e limitações

* Novos: `video-first-last-frame-contract.test.ts` (38: capacidades, validação, payloads Kling REST/MCP, cliente Veo, download com header por origem, fingerprint, working state, interruptor, uso derivado), `video-first-last-frame-routes.test.ts` (24: rotas Kling REST/MCP/Veo, idempotência, isolamento, resultado incerto, poller, sync, uso), `video-first-last-frame-workspace.test.tsx` (12: workspace real). Atualizados: listagem de conexões (agora inclui Google Veo), `lastFrame:false` no pedido normalizado, `.or()` no `fake-db`, fixture `who_am_i` com os textos reais do Kling 2.6.
* Limitações: nenhum contrato de provedor foi exercitado de verdade (mocks); a UI de seleção usa o seletor existente (não há miniatura antes de a imagem ser escolhida na sessão restaurada — mostra "Imagem final selecionada"); o diálogo legado `create-video-generation-dialog` não monta o slot B (não é usado pela aplicação); Veo guarda os frames em memória no envio (≤ 7 MB cada).

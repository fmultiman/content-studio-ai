# SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_PREFLIGHT_V1

Status: preflight de implementação; nenhum código de produto foi alterado.

## 1. Objetivo e limites

A próxima missão implementará o núcleo compartilhado de Review, o adapter de
Image e a persistência normalizada. Esta missão apenas congela o contrato.

Review é análise advisory de um Attempt/output histórico. Review não é Approval,
não publica, não cria LibraryFile, não altera Authoring e não dispara nova
geração. O novo Review nunca grava em ImageDraft.

Fora desta implementação: Video Review; mudanças em Session, Attempt, providers,
autosave, Library, Approval, Creative Editor ou Undo/Redo; exclusão de ImageDraft;
chamadas pagas; aplicação de migration.

A linha canônica passa a ser:

Project/Production/Identity server-authoritative
  -> ImageGenerationSession
  -> ImageGenerationAttempt
  -> Image output
  -> Review
  -> refinedPrompt opcional
  -> aceitação explícita no Session

## 2. Checkpoint e evidência

- origin/main inicial verificado: c082728878603550e70f67ce83f0e96784b79d23.
- worktree reutilizado: C:\Users\flavi\.traycer\worktrees\fmultiman__content-studio-ai\feat-image-generation-session-attempt-foundation-v1.
- branch anterior: feat/generation-session-autosave-reliability-v1.
- branch desta preflight: discovery/shared-review-core-image-adapter-preflight-v1.
- HEAD inicial: c082728878603550e70f67ce83f0e96784b79d23.
- product code alterado: não.
- captura Supabase read-only: projeto nuhdhnasuohizxtmyiju, UTC
  2026-10-06T00:44:13.174517+00:00.
- inventário: docs/migrations/shared-review-core-image-adapter-preflight-v1-inventory.json.

As contagens atuais reconciliam 29 ImageDrafts para 29 Sessions, 23 Attempts
históricos, 18 Attempts com avaliação não nula e 5 com JSON null. Das 18
avaliações, 17 têm result_image_id e uma não tem output. Existem 6 avaliações
atuais nos Sessions; cada uma coincide com uma avaliação histórica. Não há tabela
normalizada de Review no banco atual.

## 3. Auditoria atual do Image Review

### UI

A entrada é app/(dashboard)/imagens/page.tsx:946-1044,
handleEvaluateImage. Ela exige imageUrl e generatedPrompt locais, lê Project e
Identity já carregados no browser, normaliza Identity, e envia
userInput/generatedPrompt/imageUrl/projectId/context/evaluation_mode/identity/attempt
para POST /api/evaluate-image.

A resposta fica em currentEvaluation e é anexada ao histórico por currentImage.id
ou por um ID sintético. Isso é projeção React, não autoridade histórica.

components/images/image-result.tsx:122-165 mostra score, approved, feedback,
improvements e refinedPrompt. O botão Usar prompt refinado chama o callback em
154-163. components/images/generation-history.tsx:39-168 renderiza a avaliação
dentro do tipo legado GenerationAttempt de lib/types.ts:65-74.

handleUseRefinedPrompt em page.tsx:1046-1061 altera o prompt local, limpa a
avaliação e incrementa contador visual. Na implementação futura, deve receber
uma Review histórica, copiar a sugestão para o Session atual através do autosave,
e não alterar Review/Attempt ou gerar automaticamente.

handleApprove em page.tsx:1630-1675 altera images.status. Esta decisão de usuário
continua separada de qualquer assessment da Review.

### Endpoint

app/api/evaluate-image/route.ts:34-317 é a autoridade atual. Em :48-58 aceita
prompt, URL, context, evaluation mode, attempt e identity; projectId enviado pelo
client nem é resolvido. Em :67-81 valida apenas a forma da Identity client-side.
Em :83-91 resolve credencial OpenAI. Em :93-96 compila o contexto recebido.
Em :225-255 chama OpenAI Chat Completions com model
OPENAI_EVALUATION_MODEL ou gpt-4o-mini (:232), imagem image_url detail low
(:240-247). Não persiste Review ID, lifecycle, model de avaliação, contexto
congelado ou subject.

O prompt atual (:193-201) exige score, approved, feedback, improvements e
refinedPrompt. extractJson está em :14-26. O defeito crítico está em :281-303:
JSON inválido recebe score 75, approved true, feedback genérico e prompt
original; JSON válido incompleto também recebe defaults. A nova implementação
deve remover esse comportamento.

### Persistência

applyCanonicalSessionState em page.tsx:405-460 hidrata
session.legacyCurrentEvaluation e attempt.legacyEvaluation (:433-445).
refreshCanonicalExecution em :475-504 reconstrói o histórico a partir de Attempts
normalizados, levando a avaliação legada junto.

A avaliação feita no workspace canônico fica em React state
(:993-1022); não pertence ao workingState do Session. No caminho antigo,
saveImageDraft em :353-402 grava currentEvaluation e generationAttempts no
ImageDraft. Essa escrita é somente compatibilidade e não poderá receber Review
nova.

A Foundation documenta legacy_current_evaluation e legacy_evaluation como
preservação, não Review authority. Eles permanecem intactos e read-only para o
novo Review.

## 4. Sujeito da Review

O sujeito primário é o par tipado:

- image_generation_attempts.id: prompt/model/provider/config/source histórico;
- images.id: output concreto analisado.

Review não referencia Session como sujeito, pois Session é mutável. Attempt sem
result_image_id não recebe Review nova. Para uma execução nova, o serviço exige
Attempt do usuário, output do usuário, escopo Project/Production coerente e
output concluído. O outputless histórico permanece compatibility-only.

Um Attempt/output pode ter várias Reviews imutáveis. Re-review cria nova linha;
não atualiza linha concluída. GET retorna items, latestCompleted e
latestExecution, todos filtrados pelo usuário.

## 5. Persistência física

### Decisão

V1 usa uma tabela compartilhada public.media_reviews com metadados comuns e
result_payload JSONB versionado. V1 tem FKs tipadas para Image:

- image_attempt_id -> image_generation_attempts(id);
- image_output_id -> images(id).

subject_media_type é image na V1. Video futuro adiciona video_attempt_id e
video_output_id por migration aditiva e atualiza o CHECK exactly-one. Não usar FK
polimórfica opaca nem tabela Image separada.

### Migration planejada

scripts/054_create_media_reviews.sql, sem criação/aplicação nesta preflight.

Campos:

| campo | regra |
|---|---|
| id | uuid PK |
| user_id | uuid NOT NULL, auth.users |
| subject_media_type | text NOT NULL, V1 image |
| image_attempt_id | uuid NOT NULL FK, RESTRICT |
| image_output_id | uuid NOT NULL FK, RESTRICT |
| project_id | uuid nullable FK, cópia do Attempt |
| production_id | uuid nullable FK, não inventar |
| adapter_key / adapter_version | NOT NULL |
| review_schema_version | integer NOT NULL, 1 |
| origin | live ou legacy_import |
| status | pending, running, completed, failed |
| client_request_id | uuid NOT NULL, unique por user |
| request_fingerprint | text NOT NULL |
| subject_snapshot | jsonb NOT NULL objeto |
| context_snapshot | jsonb NOT NULL objeto |
| evaluator_provider/model/prompt_version | nullable até execução |
| overall_score | numeric nullable, somente 0..100 para Review nova |
| overall_assessment | enum advisory nullable |
| summary | text nullable |
| result_payload | jsonb NOT NULL objeto |
| refined_prompt | text nullable |
| failure_code / failure_details | nullable e sanitizado |
| legacy_source_key | nullable, unique para import |
| created_at/started_at/completed_at/failed_at/updated_at | timestamps |

CHECKs exigem JSONB objeto, score novo nulo ou 0..100, failed com failure_code,
origin legacy_import com legacy_source_key e sujeito Image com os dois FKs.
Não criar approved, approval_status ou library_file_id.

Índices: user+created_at; user+image_attempt+created_at; output; project;
unique user+client_request_id; unique parcial de tentativa ativa
(pending/running); unique parcial legacy_source_key.

Trigger de lifecycle permite somente pending->running e terminal
completed/failed. Subject, snapshots, adapter/schema, client key,
fingerprint, owner e created_at são imutáveis. Authenticated só possui SELECT
próprio via RLS; writes passam por service role após autenticação e validação de
escopo. Não há DELETE para authenticated.

Migration de backfill separada:
scripts/055_backfill_legacy_image_reviews.sql. Antes da implementação, conferir
que 054/055 continuam números livres; se houver conflito, parar.

## 6. Contexto authoritative e snapshot

POST fornece somente attemptId e clientRequestId. O serviço carrega Attempt
filtrando pelo usuário e resolve Session, Project, Production, Identity e
output por referências armazenadas. Não aceitar context, identity, imageUrl,
generatedPrompt, projectId, productionId ou evaluation_mode do client.

Identity é validada pelo schema V1 no servidor. Identity ausente é válido; Identity
malformada falha com project_identity_invalid. Production ausente continua nula.
Project/Production incompatíveis falham.

context_snapshot guarda schemaVersion, capturedAt, Project id/context/
evaluationMode, Identity semântica e Production id/title/intention/type. O
snapshot não é apenas uma FK: edição posterior do Project não muda o sentido
histórico. Usar schema_version + fingerprint; não chamar projects.updated_at de
versão de Identity porque não há coluna própria.

A Identity semântica V1 inclui foundation.purpose, relationship.audience,
expression.visual_identity, governance.principles, governance.restrictions e
practice.generation_preferences. expression.voice, visuals.colors e
visuals.typography ficam fora, pois o compiler atual não os usa na avaliação e
os tokens pertencem ao Creative Editor.

subject_snapshot guarda Attempt/output IDs, submittedPrompt, provider, model,
submittedConfig, sourceSnapshot, output metadata estável e fingerprint. Nunca
guardar secret ou signed URL. Re-review resolve media pelo storage boundary
server-side; URL remota arbitrária do client é recusada. Dados legados podem ser
importados sem executar evaluator mesmo quando não há locator verificável.

### Identity matrix

| campo | hoje | compiler atual | Review V1 |
|---|---:|---:|---|
| foundation.purpose | sim | sim | snapshot |
| relationship.audience | sim | sim | snapshot |
| expression.visual_identity | sim | sim | snapshot |
| expression.voice | sim | não | excluir |
| governance.principles | sim | sim | usar alignment |
| governance.restrictions | sim | sim | issues, nunca Approval |
| practice.generation_preferences | sim | sim | preferência |
| visuals.colors | sim | não | excluir |
| visuals.typography | sim | não | excluir |
| Project context/evaluation_mode | sim | sim | snapshot authoritative |
| Production title/intention/type | sim | não no endpoint atual | snapshot opcional |
| Identity revision | não | não | schema_version + fingerprint |

## 7. Contrato comum

Arquivo futuro: lib/reviews/contracts.ts.

~~~ts
type ReviewStatus = 'pending' | 'running' | 'completed' | 'failed'
type ReviewAssessment = 'strong' | 'mixed' | 'needs_revision' | 'insufficient_evidence'

type ReviewCriterionV1 = {
  key: string
  label: string
  score: number | null
  assessment: ReviewAssessment | null
  evidence: string[]
  applicable: boolean
}

type ReviewResultV1 = {
  schemaVersion: 1
  status: 'completed'
  adapter: { key: string; version: string }
  overall: { score: number; assessment: ReviewAssessment }
  summary: string
  criteria: ReviewCriterionV1[]
  strengths: string[]
  issues: string[]
  recommendations: string[]
  refinedPrompt: string | null
  adapterResult: Record<string, unknown>
}
~~~

ReviewRecordV1 inclui id/status, subject mediaType/attemptId/outputId,
projectId/productionId, adapter, reviewSchemaVersion, evaluator
provider/model/promptVersion, contextFingerprint, result/failure,
refinedPrompt, origin e timestamps.

O core valida envelope, status, score, arrays, enum e coerência de
refinedPrompt. Ele não conhece chaves de critérios Image ou Video. Não existe
verdict Approval.

## 8. Image adapter

Arquivo futuro: lib/reviews/adapters/image.ts.

O adapter recebe somente contexto resolvido no servidor, Attempt e
OwnedImageForReview. Ele implementa:

- buildPrompt usando semantic context congelado;
- parse estrito do resultado do provider;
- toResult para ReviewResultV1;
- extração opcional de refinedPrompt;
- mapeamento de erro sem defaults.

Critérios estáveis:

| key | label | quando |
|---|---|---|
| prompt_adherence | Aderência ao prompt/intenção | sempre |
| identity_alignment | Alinhamento à Identity | quando há Identity |
| composition | Composição/hierarquia/legibilidade | sempre |
| visual_quality | Qualidade visual/artefatos | sempre |
| source_fidelity | Fidelidade a source/reference | quando snapshot prova referência |
| text_legibility | Legibilidade de texto | quando prompt exige texto |

Cada critério tem score 0..100, assessment, evidence e applicable. Não aplicável
fica com score/assessment nulos. Não inventar source fidelity quando não há
source. evaluation_mode vira dado de contexto/adapterResult, nunca Approval.

## 9. Score, malformed output e Approval

Review nova usa score 0..100 e assessment advisory. Não existe regra
score>=X -> approved. O response novo não contém approved.

Scores legados 6, 7, 8, 40, 65, 75 e 85 provam escala desconhecida. Não
preencher overall_score normalizado; preservar raw score em
result_payload.legacyPayload com scoreScale unknown.

JSON inválido/truncado, campos faltantes, score impossível, enum inválido,
provider error, timeout ou media/context inválido produzem Review failed, nunca
resultado fabricado. Não usar score 75, approved true, feedback neutro ou
prompt original como fallback.

Depois de subject válido, persistir falha sanitizada com failure_code; antes de
subject válido retornar erro sem linha. Não persistir API key, prompt secreto
ou body bruto do provider.

Review completa não altera images.status, não aprova/rejeita, não cria
LibraryFile, não publica, não cria authoring state, não muda Attempt/Session e
não gera.

## 9.1. Compatibilidade futura com Video

Video Review não é implementado nesta missão. O envelope comum já deixa o
adapter escolher suas próprias chaves em criteria e seu objeto adapterResult.
Um futuro adapter video-temporal-v1 poderá usar, por exemplo,
temporal_coherence, motion_quality, continuity, camera_behavior, pacing,
source_fidelity, audio_quality e av_sync, além de evidências com timestamps ou
frame ranges. Essas chaves não entram no Image adapter nem em colunas físicas
dedicadas. O único trabalho futuro de banco é adicionar os FKs tipados de Video
e habilitar o discriminador video.

## 10. Lifecycle, re-review e idempotência

V1 continua síncrona, mas persiste pending -> running -> completed|failed.
Criar a linha depois de auth/subject/context/credential preflight e antes da
chamada paga. O service fecha a mesma linha.

clientRequestId é obrigatório e estável por clique lógico. Reenvio da mesma chave
retorna a mesma Review sem segunda chamada. Outra chave enquanto há execução
ativa retorna 409 REVIEW_IN_PROGRESS. Após failure, nova chave permite retry.
Re-review explícita usa nova chave e nova linha.

Provider/model atuais: OPENAI_EVALUATION_MODEL ou gpt-4o-mini, registrados no
record. Testes usam fetch/credential doubles e zero chamadas reais.

## 11. API

### POST /api/reviews/image

Request:

~~~json
{"attemptId":"uuid","clientRequestId":"uuid"}
~~~

Respostas: 200/201 ReviewRecordV1; 400 shape; 401 auth; 403/404 scope ou
sujeito; 409 execução ativa; 422 Identity/media/context; 502 provider/parse
failure com reviewId quando já existe; 500 sem detalhe sensível.

### GET /api/reviews/image?attemptId=uuid

Retorna:

~~~ts
type ReviewHistoryV1 = {
  items: ReviewRecordV1[]
  latestCompleted: ReviewRecordV1 | null
  latestExecution: ReviewRecordV1 | null
}
~~~

### Endpoint legado

O código novo não chama /api/evaluate-image. Durante a janela de compatibilidade,
a rota deve aceitar apenas a nova forma attemptId/clientRequestId e delegar ao
mesmo service, ou devolver 410 IMAGE_REVIEW_API_MOVED para o body antigo. Não
manter uma segunda avaliação que aceite URL/context/Identity client-trusted.
Remover depois que rg confirmar que nenhum consumidor legítimo resta.

## 12. refinedPrompt

refinedPrompt é sugestão histórica da Review. Usar exige ação explícita:

1. copiar para o Session atual por setLocal/autosave;
2. aguardar acknowledgement normal;
3. não alterar Review;
4. não alterar Attempt;
5. não gerar automaticamente.

Se a Review histórica for vista depois de o prompt atual mudar, a ação explícita
ainda pode substituir o prompt atual; mostrar confirmação se houver dirty/conflict.
Não criar review_suggestions.

## 13. Migração legada

Migration: scripts/055_backfill_legacy_image_reviews.sql, rerun-safe por
legacy_source_key, sem apagar ou reescrever ImageDraft/Attempt.

| classe | quantidade | destino |
|---|---:|---|
| MIGRATE_EXACT | 0 | metadata histórica insuficiente |
| MIGRATE_PARTIAL | 17 | media_reviews, origin legacy_import, output conhecido |
| PRESERVE_LEGACY_ONLY | 1 | JSON legado; output nulo |
| NO_LEGACY_REVIEW | 5 | nenhum Review |
| AMBIGUOUS | 0 | nenhum |
| DISCARDED | 0 | nenhum |

Os 17 recebem adapter image-legacy-compat, version legacy-json-v1, status
completed de importação, overall_score/assessment nulos, raw JSON no
legacyPayload, provider/model/promptVersion nulos e context snapshot com
unknown explícito. A linha outputless não recebe Review normalizada. As 5 sem
avaliação não recebem linha. As 6 current evaluations são aliases e não geram
linhas extras.

Reconcile pós-migration: 29 drafts, 29 Sessions, 23 Attempts, 17 Reviews
legacy_import, 1 avaliação outputless preservada, 5 sem Review, images e
library_files sem aumento, Video sem mudança, hashes do inventário iguais,
legacy JSON semanticamente intacto.

## 14. Fate de ImageDraft

Review normalizada é authority para Reviews novas. ImageDraft JSON e as colunas
legacy_* das Sessions/Attempts ficam read-only para histórico. Nenhum POST de
Review escreve ImageDraft. Leitura fallback somente quando não existe linha
normalizada; linha normalizada prevalece e não duplica UI.

Remoção só depois de todos consumers canônicos usarem GET de Review, backfill
reconciliado, decisão para outputless, nenhum writer novo e uma missão posterior
aprovar cleanup. Não deletar nesta missão.

## 15. UI futura

app/(dashboard)/imagens/page.tsx deve usar Attempt ID real, POST/GET novos e
fallback legado. currentEvaluation deixa de ser autoridade; Review history vem
do endpoint.

components/images/image-result.tsx deve exibir Review advisory, sem badge
approved. components/images/generation-history.tsx deve exibir Review por
Attempt normalizado e marcar fallback legado. lib/types.ts mantém tipos legados
e adiciona/reexporta shared types.

Evaluate/loading/refined prompt continuam. Approval e Save to Library continuam
ações distintas. Review não entra no Session workingState/autosave.

## 16. Arquivos da próxima implementação

### Shared core

| path | change | test |
|---|---|---|
| lib/reviews/contracts.ts | Zod/types envelope/context/failure/history | valid/missing/enums |
| lib/reviews/service.ts | orchestration injected | lifecycle/idempotency |
| lib/reviews/repository.ts | repository media_reviews | ownership/concurrency |
| lib/reviews/context.ts | resolve subject/scope/snapshot | authority/fingerprint |
| lib/reviews/errors.ts | sanitized public errors | mapping |
| lib/reviews/adapters/types.ts | adapter interface | fixture compile |

### Image/API/UI

| path | change | test |
|---|---|---|
| lib/reviews/adapters/image.ts | prompt/parser/mapper | criteria/invalid |
| app/api/reviews/image/route.ts | POST/GET auth/service | HTTP/security |
| app/api/evaluate-image/route.ts | wrapper/rejection/deprecation | old body rejected |
| app/(dashboard)/imagens/page.tsx | IDs, Review GET/POST, fallback | integration |
| components/images/image-result.tsx | advisory view | no Approval side effect |
| components/images/generation-history.tsx | normalized history | legacy precedence |
| lib/types.ts | preserve/reexport contracts | type fixture |

### DB/backfill

| path | change | test |
|---|---|---|
| scripts/054_create_media_reviews.sql | table/checks/index/RLS/triggers | schema/RLS |
| scripts/055_backfill_legacy_image_reviews.sql | 17 imports, rerun safe | counts/hashes |
| docs/migrations/...inventory.json | input evidence | reconciliation |

### Tests

lib/reviews/__tests__/contracts.test.ts; service.test.ts; context.test.ts;
lib/reviews/adapters/__tests__/image.test.ts;
app/api/reviews/image/route.test.ts;
app/(dashboard)/imagens/review-compatibility.test.tsx;
scripts/shared-review-backfill.test.mjs;
lib/reviews/__tests__/no-paid-calls.test.ts.

## 17. Ordem segura

1. Confirmar números 054/055 e revalidar inventário.
2. Contratos e parser, testes puros.
3. Migration 054, RLS/triggers, schema tests.
4. Repository/context resolver e ownership tests.
5. Image adapter e invalid-output tests.
6. Service lifecycle/idempotency/review history.
7. Backfill 055 dry-run/fixtures; reconciliar 17/1/5.
8. API POST/GET; deprecate body legado.
9. UI Attempt IDs, normalized precedence e fallback.
10. refinedPrompt acceptance via Session autosave.
11. live reconciliation, security, typecheck, lint, build.
12. closure doc/PR.

Não iniciar Video Review.

## 18. Testes mínimos e stop conditions

Testar: ownership cross-user; Attempt sem output; Project/Production mismatch;
Identity client adulterada; context snapshot; envelope válido; JSON inválido;
missing keys; score inválido; provider error/timeout; persistence; múltiplas
Reviews; double click idempotente; active duplicate; refinedPrompt apenas no
Session; Approval invariável; Library invariável; zero ImageDraft writes;
backfill 17/1/5 sem duplicação; normalized precedence; Video fixture compile;
zero paid calls.

Parar sem improvisar se:

- não houver ligação segura Attempt/output;
- migration exigir perda de legado;
- Identity exigir redesign/client trust;
- FK polimórfica opaca for necessária;
- Review precisar mutar Attempt/Session/Approval;
- output só existir em URL client-trusted;
- parser exigir fallback de sucesso;
- provider pago for necessário;
- migration 054/055 estiver ocupada;
- RLS não puder filtrar o próprio user;
- autosave/Library/Video precisarem mudar;
- Review nova precisar escrever ImageDraft;
- score legado precisar ser adivinhado.

## 19. Próxima missão

SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_V1

Ela implementará somente este contrato. VIDEO_REVIEW_ADAPTER_V1 só começa após
backfill, compatibility reconciliation e testes de ausência de Approval/Library
estarem verdes.

# VIDEO_AI_GENERATION_KLING_V1

## Phase 0/1: Reconnaissance & Real Provider Adapter Readiness
**Status:** IMPLEMENTED / VALIDATION BLOCKED

### Current Implementation State
1. **Migrations (039_create_video_generations.sql)**: NOT APPLIED to production yet. Implements accurate XOR Constraint: I2V demands exactly ONE origin (`source_image_id` OR `source_library_file_id`); T2V demands BOTH to be NULL.
2. **Kling Auth Contract**: Updated. JWT legacy implementation removed. Replaced with `Authorization: Bearer <KLING_API_KEY>`.
3. **Current API Base**: `https://api-singapore.klingai.com`.
4. **I2V Endpoint**: `POST /image-to-video/kling-3.0` using contents/settings/options format.
5. **T2V Endpoint**: `POST /text-to-video/kling-3.0` fully modeled but frozen on UI to wait for Slice 1B approval.
6. **Task Query Contract**: `GET /tasks/{taskId}` handled correctly with dynamic mapping matching original standard.
7. **Model Snapshot**: Set strictly to internal product abstraction targeting implicitly Kling V3 infrastructure according to API endpoint strings (requesting base parameters 720p, duration 5s without audio).
8. **Status Normalization**: `succeeded`, `failed`, `submitted`, `processing`.
9. **Webhook Signature Implementation**: Rota implementada com checagem de tolerancia (`+- 5 min`), leitura bruta (`req.text()`), Constant-Time comparison via Node `crypto`, rodando `HS256` em base64 da string `.whsec`.
10. **Fixture Test Webhook**: Teste `lib/api/kling/callback/__tests__/route.test.ts` implementado seguindo mock do standard.

### Checkpoint Validations

- **Tests / Typecheck / Lint / Build State**: BLIND / BLOCKED on Windows Sandbox. A dependência `esbuild.exe` falhou no postinstall do NPM por restrições locais do host (spawnSync EFTYPE). Por favor rode na sua master machine: 
`npm ci && npm run typecheck && npm run test`
- **Migration Applied?**: NO.
- **KLING_API_KEY present?**: NO.
- **KLING_WEBHOOK_SECRET present?**: NO.
- **API Balance Requirement Identified?**: UNKNOWN (Impossível ler a documentação diretamente no sandbox, requer tentativa ou dashboard da UI do Kling Provider).

**Exato Remaining Step Before Real I2V:**
Aguardando build success proof via máquina do Usuário (typecheck/lint). E preenchimento das credenciais `.env` com a API Key e Webhook Secret. O usuário pode então chamar a API test do ping ou disparar 1 teste I2V após autorização.
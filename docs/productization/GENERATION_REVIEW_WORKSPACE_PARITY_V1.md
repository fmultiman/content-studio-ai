# Generation + Review workspace parity V1

Baseline: `origin/main ac8ace8`. O workspace de geração de vídeo é `/videos/geracoes/:sessionId`; `/videos` continua sendo a entrada contextual e o histórico. Nenhuma alteração de credencial, variável ou schema.

| Fluxo | Imagens | Vídeos |
|---|---|---|
| Manual | Prompt editável + gerar | Prompt/motion prompt editável + gerar |
| Assistido | Criar/Melhorar com IA | Criar/Melhorar com IA, modelos textuais OpenAI/Gemini, contexto T2V/I2V |
| Aplicar sugestão | Explícito | Aplicar/Descartar; confirmar substituição de prompt existente |
| Automático | Preferência + início explícito | Mesma preferência; 1 assistência + 1 submissão Kling; sem retry oculto |
| Sessão/autosave/histórico | Persistentes | Persistentes; assistência opcional no JSON V1, compatível com sessões antigas |
| Review → refinamento | Operacional | “Usar prompt refinado” copia para o prompt editável; gerar novamente exige ação |
| Custos | BYOK e custo parcial | BYOK textual separado de unidades REST/créditos MCP; custo estimado parcial ou indisponível |
| Controles próprios | Modelo e formato de imagem | Modelo, transporte, duração, resolução, áudio, motion prompt e origem preservados |

## Autorização e recuperação

- Manual e Assistido nunca geram por efeito, hidratação, sugestão recebida ou aplicação do Review.
- Automático exige a preferência existente “Permitir modo Automático”, provedor textual configurado, conexão Kling utilizável e um início explícito. Um prompt existente exige confirmação antes de qualquer chamada.
- O cancelamento pode parar o fluxo durante assistência ou salvamento, antes do POST de vídeo. Sair do workspace antes desse POST também cancela o restante. Depois do envio, a tarefa do provedor continua no histórico.
- Um lock síncrono antecede a persistência e protege contra duplo clique. Cada submissão congela prompt, origem, controles e `clientRequestId` antes de qualquer await.
- Resposta incerta conserva o identificador e bloqueia novos envios na mesma aba, inclusive após reload. Releitura do histórico só desbloqueia com tarefa/resultado confirmado ou rejeição explicitamente definitiva. Um orphan `SUBMISSION_INTERRUPTED` sem tarefa permanece incerto e exige conferir a conta Kling antes de outra geração; nenhum retry pago é automático.
- Uma sessão salva em Automático nunca retoma chamadas ao abrir. Review e tentativas anteriores continuam imutáveis; o refinamento altera somente o rascunho.

## Limites reais

A assistência I2V recebe somente texto e não inspeciona a imagem. O Video Review mantém análise visual e não avalia o áudio. O Automático termina no envio de um vídeo: não executa Review, avaliação/refinamento autônomo ou múltiplas tentativas. Nenhuma chamada paga foi usada nesta entrega.

## Validação

Regressões mockadas: 423 testes de contratos/autorização/persistência/Kling/custos, 43 jornadas de vídeo, 127 regressões de Imagens/Review e 64 contratos/gates/contabilização dos engines de Review: **657 testes aprovados**. O editor manual permanece disponível mesmo sem conexão Kling ou com capacidades expiradas, com geração bloqueada. Uma conexão salva sem modelo utilizável permite escolher outra conexão explicitamente, preservando o prompt e sem gerar. Typecheck e lint verificados antes do merge; o check Vercel valida o build do commit final. A revisão independente corrigiu os cenários de cancelamento durante save, normalização da URL na criação e recuperação de submissão incerta.

## Fechamento (2026-10-12)

**Veredito: CODE DEPLOYED / SPECIFIC ACCEPTANCE PENDING.** O código está mesclado e em Production; os itens pendentes abaixo dependem de chamadas pagas ou de um estado de conta que não pôde ser reproduzido sem cobrança.

| Entrega | Evidência |
|---|---|
| PR #190 `feat/generation-review-workspace-parity-v1` | merge `eedafa9`, Production READY |
| PR #191 `fix/video-unavailable-connection-draft` | merge `d0a36b7`, Production READY em `content.multihuman.com.br` |
| PR de fechamento (testes obsoletos + este documento) | ver histórico de `main` após `d0a36b7` |

### Matriz entregue

| Capacidade | Status | Observação |
|---|---|---|
| Criar com IA (vídeo) | IMPLEMENTED | Botão e fluxo no modo Assistido; contexto T2V/I2V só texto. UI observada em Production; invocação não exercida (cobrança). |
| Melhorar com IA (vídeo) | IMPLEMENTED | Mesmo painel; UI observada em Production. |
| Aplicar / Descartar | IMPLEMENTED | Confirmação antes de substituir prompt existente; coberto por testes mockados. |
| Seleção do modelo de assistência | IMPLEMENTED | Seletor OpenAI/Gemini; observado em Production (padrão OpenAI GPT-4o mini). |
| Video Review e histórico | IMPLEMENTED | Pré-existente (VIDEO_REVIEW_UI_AND_HISTORY_V1) integrado ao workspace. Não exercido em Production (sem tentativas na sessão de teste; Review é pago). |
| Usar prompt refinado a partir do Review | IMPLEMENTED | Ação opcional por clique que copia ao prompt editável; nunca gera. Coberta por testes. |
| Gerar novamente / nova tentativa | IMPLEMENTED | Não há botão dedicado: “Gerar vídeo” cria nova tentativa com novo `clientRequestId`; Review e tentativas anteriores permanecem imutáveis. |
| Fluxo Automático opcional | IMPLEMENTED (escopo limitado) | Exige a preferência “Permitir modo Automático”; 1 assistência + 1 submissão Kling. Não executa Review nem refinamento autônomo (limite deliberado). Em Production a conta de teste tem a preferência desligada, então só o estado desabilitado foi observado. |
| Autosave e recuperação de sessão | IMPLEMENTED | Observado em Production: edição, “Salvo” e persistência após reload; recuperação de envio incerto por testes. |
| Consistência Imagens/Vídeo | PARTIAL | `WorkflowModeControl` compartilhado e mesmo vocabulário de fluxo (Manual/Assistido/Automático, Aplicar/Descartar). Não há paridade de layout idêntica nem auditoria visual lado a lado. |

### Validação em `main` `d0a36b7`

- Typecheck: sem erros. Lint: 0 erros (58 warnings pré-existentes).
- Suíte completa: 6176 testes. As 657 regressões do escopo (423 + 43 + 127 + 64) estão contidas na suíte completa, mas os grupos não foram reexecutados separadamente com a mesma contagem; `components/videos` isolado: 12 arquivos / 213 testes aprovados.
- Falhas na suíte completa, separadas por origem:
  - **Novas, introduzidas pelo #190 (afirmações obsoletas), corrigidas neste fechamento:** `video-review-surfaces.test.ts` (marcador do `VideoReviewControl` e proibição de adoção de prompt, agora uma ação opcional explícita) e `settings-and-resolver-modes.test.ts` (a rota passou a devolver `automationEnabled`). Nenhum código de produto mudou.
  - **Pré-existentes, reproduzidas em `ac8ace8` (anterior ao #190):** `editor-workspace.test.ts` e `static-parity.test.ts` (rótulo “Estilos” vs. “Estilo” do Inspector do editor criativo). Fora do escopo desta entrega e não alteradas.
  - **Instável sob carga:** `video-workspace-parity.test.tsx › retains the same uncertain submit across remount` falhou uma vez na suíte completa e passa isolada; a primeira execução completa teve mais falhas que a segunda, compatível com timeouts sob carga.

### Evidência em Production (sessão autenticada, sem geração, Review ou chamada de assistência)

- Capacidades MCP expiradas: o prompt permanece editável, mostra “Salvo”, persiste após reload e “Gerar vídeo” fica desabilitado com mensagem orientando a escolher outra conexão.
- Seleção explícita de “Kling API (API)”: o formulário completo reaparece (modelo, duração, resolução, áudio, multi-shot); a geração continua desabilitada até haver imagem de origem.
- Modo Assistido: Criar com IA / Melhorar com IA e seletor de modelo presentes e sem chamadas.
- Layout em 1366 px e 390 px: sem rolagem horizontal; botão de gerar totalmente visível.
- A sessão de teste ficou com o rascunho “Smoke de fechamento…” e a conexão API selecionada; não há tentativas.

### Pendências de aceitação específicas

1. Fluxo conectado normal com conexão MCP válida: a conta de teste só tem MCP com capacidades expiradas; renovar a conexão MCP é ação do proprietário.
2. Review e “Usar prompt refinado” sobre uma tentativa real: exige Review pago.
3. Estado sem nenhuma conexão Kling: coberto por teste mockado; não reproduzível em Production sem remover a conexão da conta.
4. Modo Automático ponta a ponta: exige habilitar a preferência e enviar um vídeo pago.

### Limites

A assistência I2V recebe somente texto. O Video Review analisa imagem, não áudio. O Automático termina no envio. Nenhuma migração, credencial ou variável foi alterada; nenhuma chamada paga foi feita nesta verificação.

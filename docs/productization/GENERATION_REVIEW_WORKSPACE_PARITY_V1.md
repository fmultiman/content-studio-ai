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

PR, merge SHA, deployment Production READY e inspeção responsiva sem cobrança serão registrados no fechamento da entrega, após a verificação do deployment final.

# Generation prompt modes + language UX convergence V1

Baseline: `origin/main e989d59` (PRs #189–#192 preservados). Nenhuma migração, credencial ou variável alterada. Nenhuma chamada paga (geração, assistência ou tradução) foi feita na implementação ou na verificação.

## Antes / depois

| Modo | Antes | Depois |
|---|---|---|
| **Manual** | Imagens: “Sua descrição” **e** “Prompt” visíveis (dois campos). Vídeos: um campo. Em Imagens, o modo Manual não era lembrado após recarregar. | **Um** campo principal: “Prompt de geração”. O briefing fica oculto, **preservado** (volta em Assistido/Automático) e pode virar prompt só por clique em “Usar a descrição como prompt”. Nenhuma assistência ou tradução implícita. O modo escolhido é persistido na sessão de Imagens (campo opcional no JSON; sessões antigas inalteradas). |
| **Assistido** | Botões sem explicação quando desabilitados; rótulos diferentes (“Aplicar” × “Aplicar sugestão”; “Prompt” × “Motion Prompt”). | “Sua descrição” é o briefing; “Criar com IA” propõe um prompt em inglês; “Melhorar com IA” usa o **prompt de geração atual**. Motivo visível quando um botão está desabilitado. Sugestão sempre com **Aplicar sugestão / Descartar** (Aplicar substitui o prompt editável, com confirmação se havia texto; Descartar preserva o anterior). Nunca gera mídia. |
| **Automático** | Imagens: botão “Criar Imagem” concorrente. Vídeos: botão “Gerar vídeo” concorrente; sessão salva em Automático sem condições ficava com painel inerte. | A descrição é a entrada; modelo de assistência e modelo de geração visíveis (resumo “Prompt: … → Imagem/Vídeo: …”); **uma** ação “Gerar automaticamente”; sem botão concorrente; etapas e progresso; o prompt resultante aparece em “Prompt de geração” (somente leitura). Automático indisponível em Vídeos é exibido como Assistido (a seleção salva não muda). Máx. 1 assistência + 1 submissão por autorização; idempotência, autosave e Review inalterados. |

## Semântica real das abas de idioma

| Aba | O que é |
|---|---|
| **Prompt (enviado)** | O **único** prompt canônico: é exatamente o texto enviado ao provedor. Está no idioma em que foi escrito ou produzido (a assistência responde em inglês; um prompt manual em português continua em português — nada é convertido). |
| **Português (leitura)** | Tradução **opcional, somente leitura**, para compreensão. Nunca é enviada, nunca substitui o prompt, não é um segundo prompt. |

Regras (Imagens e Vídeos, mesmo componente `PromptLanguagePanel` + hook `usePromptTranslation`):

- Abrir a aba **não** chama provedor (antes, abrir “Portugues” disparava uma chamada OpenAI). A tradução só ocorre no clique em “Traduzir para português”, com aviso de custo BYOK (chave OpenAI do usuário) e motivo claro quando indisponível.
- Reutiliza o serviço existente `POST /api/prompts/translate` (OpenAI `gpt-4o-mini`, BYOK, sujeito ao guard de execução paga). Não foi criada outra rota.
- Cache: enquanto o prompt não muda, alternar abas ou clicar de novo não faz nova chamada. Em Imagens a tradução continua persistida na sessão e é restaurada junto com o prompt a que pertence; em Vídeos é mantida durante a sessão de edição (não persistida).
- Invalidação: editar o prompt descarta a tradução e aborta qualquer solicitação em andamento; uma resposta tardia de um prompt anterior é descartada (inclusive A→B→A). Carregar uma sessão salva é tratado como par prompt/tradução (época explícita).
- Não há tradução fabricada: sem tradução real, a aba mostra o estado vazio e o botão; “Copiar” em português só copia a tradução existente.

## Prompt efetivamente enviado à geração

| Área | Prompt enviado |
|---|---|
| Imagens (OpenAI, Google Gemini, NanoBananaAPI.ai) | `generatedPrompt` (o campo “Prompt de geração”). Nunca a descrição (o código recusa gerar sem prompt) nem a tradução. |
| Vídeos (Kling REST/MCP) | `prompt` do estado de trabalho congelado no envio (mesmo campo, T2V ou I2V). Nunca a descrição nem a tradução. |
| Automático | O texto retornado pela única chamada de assistência, gravado no campo “Prompt de geração” antes do envio e usado sem alteração. |

## Matriz final Imagens × Vídeos

| Capacidade | Imagens | Vídeos |
|---|---|---|
| Manual com campo único | IMPLEMENTED | IMPLEMENTED |
| Briefing preservado + “Usar a descrição como prompt” | IMPLEMENTED | IMPLEMENTED |
| Modo escolhido persistido e restaurado | IMPLEMENTED (novo, opcional no JSON) | IMPLEMENTED (já existia) |
| Criar/Melhorar com IA, modelo de assistência, motivo de desabilitado | IMPLEMENTED | IMPLEMENTED |
| Aplicar sugestão / Descartar | IMPLEMENTED | IMPLEMENTED |
| Automático sem botão concorrente, prompt resultante, modelos visíveis | IMPLEMENTED | IMPLEMENTED |
| Aba Português somente leitura, sob demanda, cache e invalidação | IMPLEMENTED (persistida) | IMPLEMENTED (em memória) |
| Rótulos e hierarquia (“Prompt de geração”, “Sua descrição”, “Aplicar sugestão”) | IMPLEMENTED | IMPLEMENTED |
| Diferenças do meio (modelo/formato de imagem × conexão/operação/duração Kling, imagem de origem I2V) | preservadas | preservadas |

## Validação

Ver o relatório de fechamento da missão (PR, SHA, testes e Production). Cobertura nova: `components/prompts/use-prompt-translation.test.tsx` (invariantes do hook), `components/images/prompt-modes-language-ux.test.tsx` e o último `describe` de `components/videos/video-workspace-parity.test.tsx` (comportamento real dos dois workspaces com rede mockada), além de ajustes mínimos de testes que codificavam o layout anterior.

## Limitações materiais

- A tradução só existe via OpenAI (`gpt-4o-mini`, rota existente); sem chave OpenAI a aba Português fica indisponível mesmo com Gemini configurado, e a chamada de tradução não grava linha de uso/custo (comportamento pré-existente da rota).
- Em Vídeos a tradução não é persistida (some ao recarregar); em Imagens é.
- O modo padrão de uma sessão **nova** continua diferente por mídia (Imagens: Assistido; Vídeos: Manual), preservando o comportamento anterior; o modo escolhido passa a ser lembrado nas duas.

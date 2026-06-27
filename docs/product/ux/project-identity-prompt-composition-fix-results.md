# Project Identity Prompt Composition Fix Results

Data: 2026-06-27  
Branch: `fix/project-identity-prompt-composition`  
Escopo: corrigir a composicao e traducao de prompts de imagem envolvendo Project Identity.

## Causa

O fluxo de imagem usava `generateImagePrompt` no client. Quando nao havia chave OpenAI, ou quando o provider falhava, a funcao caia silenciosamente no fallback local.

Esse fallback concatenava:

- descricao do usuario;
- `grounded in this context`;
- bloco compilado de Project Identity com headings Markdown;
- defaults de modo;
- estilo visual;
- iluminacao e composicao aleatorias;
- keywords finais.

O resultado era exibido como prompt real em ingles, apesar de conter grande parte do texto em portugues e contexto interno.

## Decisao de produto

O fallback simulado nao deve ser usado automaticamente no fluxo normal.

Sem provider configurado, a geracao de prompt deve falhar de forma clara e estruturada. Quando o provider falhar ou retornar resposta invalida, o sistema deve preservar o estado do usuario e permitir nova tentativa, sem substituir a resposta por simulacao.

## Caminho real

O caminho real com provider continua usando:

- intencao do usuario;
- contexto legado do Project;
- Project Identity normalizada;
- restricoes;
- preferencias;
- `evaluation_mode`.

Esses dados sao enviados como contexto interno ao modelo. O contrato do output exige somente o prompt final em ingles, sem headings, markdown, metadados, `grounded in this context` ou raciocinio interno.

## Sem provider

`generateImagePrompt` agora retorna erro estruturado:

```text
PROMPT_PROVIDER_NOT_CONFIGURED
```

Mensagem para o usuario:

```text
A geração de prompts precisa de um provedor de IA configurado. Configure sua chave da OpenAI em Configurações e tente novamente.
```

A tela preserva a descricao digitada e nao cria prompt falso.

## Falha do provider

Falhas de provider e respostas invalidas usam erros distintos:

```text
PROMPT_PROVIDER_FAILED
PROMPT_PROVIDER_INVALID_RESPONSE
```

Nao ha fallback silencioso para simulacao.

## Aba em portugues

A traducao continua sob demanda.

Com provider configurado, `/api/prompts/translate` traduz o prompt em ingles e retorna `translatedPrompt`.

Sem provider configurado, a API retorna:

```text
PROMPT_PROVIDER_NOT_CONFIGURED
```

A UI mostra:

```text
Tradução indisponível sem provedor configurado.
```

e oferece acesso a Configuracoes.

## Simulador

O simulador permanece apenas como helper explicito de teste:

```text
generateSimulatedPromptForTest
```

Ele nao e chamado automaticamente pelo fluxo normal.

## Drafts legados

Drafts antigos com `grounded in this context` continuam abrindo. Nao houve migration, reescrita automatica ou alteracao em dados persistidos.

Uma nova geracao valida pode substituir o prompt legado normalmente.

## Smoke humano

Resultado: aprovado em 2026-06-27.

### Sem provider

Validado no browser autenticado:

- geracao bloqueada com mensagem clara;
- descricao digitada preservada;
- prompt valido anterior preservado;
- nenhum fallback simulado criado;
- aba em portugues informa indisponibilidade sem provedor;
- nenhum erro generico ou console sujo;
- draft legado continua abrindo sem migration.

### Com provider

Validado no browser autenticado:

- prompt real integralmente em ingles;
- Project Identity aplicada semanticamente;
- ausencia de `grounded in this context`;
- ausencia de headings internos;
- ausencia de pontuacao quebrada;
- ausencia de preset conflitante como `neon-lit environment with color reflections`;
- restricao contra cyberpunk respeitada como restricao negativa;
- traducao em portugues integral e funcional;
- nenhum HTTP 400 inesperado;
- draft salvo e reaberto corretamente;
- Project e Production preservados.

## Copy de Configuracoes

A pagina de Configuracoes ainda dizia que, sem chave OpenAI, o sistema usaria simulacao local. Essa copy foi atualizada para refletir o contrato real: a geracao de prompts por IA requer chave OpenAI configurada e, sem chave valida, o recurso fica indisponivel.

## Testes

Testes focados cobrem:

- ausencia de API key nao usa simulador;
- erro estruturado sem provider;
- falha do provider nao cai em simulacao;
- resposta invalida do provider nao cai em simulacao;
- Project Identity e restricoes seguem no contexto interno;
- instrucao de sistema exige somente prompt final em ingles;
- `grounded in this context` e defaults aleatorios nao aparecem no fluxo normal;
- traducao com provider;
- traducao sem provider;
- nao mutacao de objetos de entrada;
- simulador acessivel apenas por helper explicito de teste.

## Itens adiados

- Revisao futura de provider server-side para geracao de prompts, evitando expor chave no client.
- Tratamento especifico de drafts legados para oferecer regeneracao assistida.
- Correcao independente da Production presa em `Carregando Production...`.

## Conclusao final

O fluxo normal nao usa mais fallback silencioso. A correcao esta pronta para validacao final e PR.

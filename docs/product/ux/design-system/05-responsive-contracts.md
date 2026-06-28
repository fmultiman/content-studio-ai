# Responsive Contracts

Este documento registra os contratos responsivos comprovados na aplicacao apos UX-H4. Ele nao define ainda tokens de breakpoint do DS-1; registra apenas o que ja foi validado como comportamento seguro.

## Regra central

```text
contrato responsivo comprovado
!= definicao final de breakpoint ou token do DS-1
```

## Viewports de validacao operacional

Os pontos efetivamente usados para validar o produto foram:

- `1600px`
- `1280px`
- `1024px`
- `768px`
- `390px`

## Contratos comprovados

### 1. Sem overflow horizontal global

- pagina, header, filtros, tabs e estados nao devem empurrar a viewport;
- overflow horizontal interno so e aceitavel quando e intencional, local e claramente usavel, como a trilha de tabs mobile de Configuracoes.

### 2. Lists densas nao dependem de tabela universal

- Imagens e Videos abandonaram o modo tabular completo;
- desktop e tablet usam duas faixas;
- mobile usa empilhamento;
- cabecalhos tabulares nao aparecem quando a linha correspondente nao existe.

### 3. Galeria preserva densidade sem comprometer legibilidade

- Cards continuam modo padrao;
- Lista compacta so aparece em configuracao segura;
- filtros se reorganizam sem expulsar `Limpar filtros` da area util;
- loading por signed URL nao pode bloquear a superficie inteira.

### 4. Acoes quebram linha quando necessario

- botoes nao devem ser comprimidos ate perder legibilidade;
- wrap e preferivel a esconder labels ou induzir overflow;
- a acao principal continua identificavel.

### 5. Metadata quebra linha com seguranca

- `Project` antes de `Production`;
- labels permanecem visiveis quando a leitura deixa de ser tabular;
- diferenca de densidade nao pode virar perda de significado.

### 6. PageHeader permanece estavel

- contexto, titulo, descricao e acoes preservam ordem de leitura;
- ausencia de blocos opcionais nao deixa espaco morto;
- mobile continua com CTA dentro da viewport.

### 7. Tabs mobile podem usar overflow interno

- Configuracoes nao precisa forcar grade rigida em `390px`;
- faixa horizontal interna e aceitavel;
- primeira e ultima tab precisam ser alcancaveis;
- o scroll interno nao deve empurrar a pagina lateralmente.

### 8. Modais e formularios preservam alcancabilidade

- footer precisa continuar acessivel em mobile;
- estados de erro e validacao nao podem empurrar a acao principal para fora da area util.

## Decisoes classificadas

| Decisao | Status | Observacao |
| --- | --- | --- |
| Breakpoints observados em 1600, 1280, 1024, 768 e 390 como referencia operacional | Confirmada | Comprovado no smoke dos lotes H4 |
| `>=1280px` como gatilho fixo para listas tabulares | Substituida | H4B1 mostrou que largura util e mais importante que viewport |
| Grid tabular como contrato padrao de listas densas | Substituida | Imagens e Videos aprovaram duas faixas permanentes |
| Faixa horizontal interna para tabs mobile de Configuracoes | Confirmada | Contrato aprovado em H4B4 |
| Tokens formais de breakpoint | Adiada para DS-1 | Ainda nao formalizados no produto |

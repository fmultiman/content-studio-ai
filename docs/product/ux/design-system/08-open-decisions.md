# Open Decisions

Este documento registra apenas pendencias reais apos a reconciliacao do UX-H4. Ele nao deve repetir hipoteses que ja foram resolvidas no produto.

## Decisoes encerradas pelo UX-H4

### Encerradas e removidas do campo de incerteza

- `PageHeader` como unica fonte do `h1`: resolvido em H4B2.
- Hubs de Imagens/Videos com listas tabulares: rejeitado em H4B1.
- Galeria com loading global dependente de todas as URLs assinadas: resolvido em H4B1.
- Cards e Lista como semanticas distintas para a mesma entidade: rejeitado em H4B3.
- `alert()` nativo no fluxo ajustado de Videos: removido em H4B4.

## Pendencias reais para DS-1

### 1. Tokens, tons e escala visual

- paleta semantica final;
- escala tipografica;
- espacamento;
- radius;
- elevacao;
- variantes formais de badge, botao e state surface.

**Classificacao:** Adiada para DS-1

### 2. Anatomia visual final das familias de card

Os contratos semanticos ja estao comprovados, mas DS-1 ainda precisa formalizar:

- anatomia visual de `ContinuationCard`, `ProjectCard`, `ProductionCard`, `DraftCard`, `GeneratedOutputCard`, `EditorialContentCard` e `FileCard`;
- pesos visuais e variantes finais;
- catalogo visual e criterios de uso.

**Classificacao:** Adiada para DS-1

### 3. Taxonomia visual final de callouts e feedback

O produto aprovou a separacao semantica entre:

- loading;
- empty;
- filtered empty;
- error;
- needs configuration;
- success inline.

DS-1 ainda precisa formalizar a anatomia visual e a escala dessas superficies.

**Classificacao:** Adiada para DS-1

### 4. Documentacao de componentes e estrategia de adocao

Ainda faltam:

- catalogo de componentes;
- exemplos de composicao;
- criterios de migracao;
- checklist de adocao por superficie.

**Classificacao:** Adiada para DS-1

## Fora do Design System

### Dominio e backend

Nao sao decisoes de DS:

- regras de schema;
- backend de retry;
- autorizacao;
- query nova so para metadata;
- comportamento de dominio editorial;
- semantica de negocio de provider alem da linguagem de UX aprovada.

**Classificacao:** Fora do Design System

## Regra para novas duvidas

Se uma decisao puder ser respondida pelo comportamento aprovado do produto, ela nao deve voltar para este documento como "aberta". Ela deve ser consolidada na reconciliacao canonica.

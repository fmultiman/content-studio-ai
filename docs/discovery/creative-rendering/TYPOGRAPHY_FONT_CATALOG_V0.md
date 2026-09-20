# Typography & Font Catalog V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** tipografia de Project Identity, catálogo de fontes, resolução e uso em preview/render


---


## 1. Objetivo


Definir como o Content Agent Studio representa, seleciona e resolve fontes sem acoplar templates ou manifests a um provider específico.


Regra central:


> O Project escolhe quais fontes fazem parte da identidade. O template decide como essas fontes são usadas.


Isso preserva a separação entre identidade e layout.


---


## 2. Produto


Direção de UI:


~~~
Project Settings
→ Identity
→ Typography
→ Font Picker
→ Project Identity
~~~


O nome exato da navegação deve respeitar a arquitetura real do produto após auditoria.


---


## 3. Typography roles


Roles iniciais sugeridos:


~~~
display
body
label
annotation
metadata
~~~


Nem todo Project precisa preencher todos os roles no V0.


Prioridade inicial:


~~~
display
body
~~~


Outros roles podem herdar de display/body enquanto ainda não forem configurados.


---


## 4. FontRef


A Project Identity não deve guardar apenas uma string informal com o nome da fonte.


Direção conceitual:


~~~json
{
  "provider": "google_fonts",
  "family": "Newsreader",
  "version": "...",
  "weights": [600, 700],
  "styles": ["normal"]
}
~~~


FontRef deve ser estável o suficiente para permitir resolução previsível e futura reprodutibilidade.


O shape final deve ser reconciliado com o schema real de Project Identity.


---


## 5. O que pertence à Identity


Preferencialmente:


~~~
typography.display
typography.body
typography.label?
typography.annotation?
typography.metadata?
~~~


A Identity pode também guardar preferências de peso por role.


---


## 6. O que NÃO pertence à Identity


Não colocar na Identity:


- font-size específico de uma cover;
- line-height específico de um template;
- número máximo de linhas;
- letter-spacing específico de uma variant;
- breakpoint/layout;
- posicionamento de text blocks.


Essas decisões pertencem ao template/style.


---


## 7. Font Catalog


O Font Catalog é uma capacidade global do Studio.


Responsabilidades:


- listar famílias disponíveis;
- pesquisar;
- mostrar preview;
- listar pesos/estilos disponíveis;
- expor metadata mínima;
- resolver uma seleção em FontRef.


Ele não é o renderer.


---


## 8. Providers


Providers possíveis:


~~~
google_fonts
studio_local
project_upload
~~~


### google_fonts


Fonte obtida de catálogo público suportado pelo Studio.


### studio_local


Fonte distribuída/curada pelo próprio Studio quando permitido.


### project_upload


Fonte enviada pelo cliente, sujeita a validação e direitos de uso.


No V0, apenas um provider pode ser implementado se isso reduzir escopo.


---


## 9. Font Picker


Experiência desejada:


~~~
Search fonts...


[ preview da família ]
[ family name ]
[ available weights ]
[ select as Display ]
[ select as Body ]
~~~


O picker pode mostrar o texto real do Project como preview.


Exemplo:


~~~
O que são comunidades alternativas?
~~~


Isso ajuda a escolha sem sair do Studio.


---


## 10. Project Identity editor


UI mínima futura:


~~~
Typography


Display font
[ Newsreader        v ]
Weight
[ 700               v ]


Body font
[ Inter             v ]
Weight
[ 400               v ]
~~~


Depois podem entrar annotation, label e metadata.


---


## 11. Resolver


Fluxo:


~~~
Project Identity
→ FontRef
→ Font Resolver
→ Resolved Font
→ Renderer loader
→ ready
→ template render
~~~


O template nunca deve buscar uma fonte diretamente em provider externo.


---


## 12. Renderer boundary


O renderer recebe fonte já resolvida ou informação suficiente para carregá-la.


Preview e final render devem usar a mesma resolução de fonte sempre que possível.


Evitar:


~~~
browser preview = fallback
final render = fonte correta
~~~


porque isso quebra paridade visual.


---


## 13. Font loading gate


Render final não deve iniciar silenciosamente sem a fonte necessária.


Estados possíveis:


~~~
font_ready
font_resolution_failed
font_variant_missing
font_load_timeout
~~~


Preview pode exibir fallback temporário apenas com warning explícito.


Final render não deve trocar fonte silenciosamente.


---


## 14. Template usage


Exemplo conceitual:


~~~
tokens.typography.display.family
tokens.typography.display.weight


tokens.typography.body.family
tokens.typography.body.weight
~~~


O Documentary Card continua controlando:


- title size;
- subtitle size;
- body size;
- line-height;
- max lines;
- responsive scale;
- overflow policy.


---


## 15. V0 for the spike


O spike principal não precisa implementar o picker.


Pode usar fixtures/hardcode controlado:


~~~
display: fixture font A
body: fixture font B
~~~


Mas o código deve entrar pela mesma fronteira conceitual que o futuro Font Resolver usará.


Evitar importar a fonte diretamente dentro de CoverVariant ou InfoVariant sem uma camada resolvida.


---


## 16. Próxima implementação curta


Após o spike ou quando houver espaço técnico, uma implementação pequena já traz valor real.


### T0 — audit


Auditar Project Identity atual, settings UI, storage/schema, font usage e componentes existentes.


### T1 — typography roles


Adicionar/confirmar display + body no contrato de Identity da forma compatível com o repo.


### T2 — provider inicial


Implementar um catálogo inicial de fontes.


### T3 — picker


Adicionar busca + preview + seleção de Display/Body.


### T4 — compile tokens


Project Identity selecionada deve compilar para VisualTokensSnapshot.


### T5 — preview integration


Trocar fonte no Project deve atualizar preview do template.


### T6 — render gate


Confirmar que still/video usam a mesma família/peso e que o render aguarda a fonte.


---


## 17. User-uploaded fonts


Pode entrar depois do provider inicial.


Requisitos:


- upload controlado;
- format validation;
- metadata;
- weight/style mapping;
- licensing acknowledgement;
- storage;
- resolver;
- preview;
- render parity.


Não precisa bloquear o primeiro Font Picker.


---


## 18. Reprodutibilidade


Quando possível, outputs aprovados devem preservar informação suficiente para saber qual família/versão/peso foi usada.


Não depender apenas de uma seleção mutável do tipo 'font latest'.


A estratégia exata de snapshot/version depende do provider e da arquitetura real.


---


## 19. Relationship to Style / Template


Identity responde:


~~~
qual família tipográfica pertence ao Project?
~~~


Template responde:


~~~
qual role usar aqui?
qual tamanho?
qual hierarquia?
como quebrar?
como responder ao canvas?
~~~


Style direction pode influenciar treatment e hierarchy, mas não deve duplicar a seleção de família da Identity sem motivo explícito.


---


## 20. Relationship to primitives


Fontes não são Visual Primitives.


Elas são recursos tipográficos resolvidos pela Identity/Font Catalog.


Uma primitive híbrida pode conter text slots, mas usa as fontes resolvidas do Project/template.


---


## 21. Não objetivos V0


- editor de fontes;
- criação de typeface;
- upload de qualquer formato sem validação;
- marketplace de fontes;
- auto-licensing;
- per-layer font picker livre;
- typography engine completo;
- substituir regras de layout dos templates.


---


## 22. Decisões V0


1. Tipografia é parte do Project Identity.
2. Templates controlam sizing/layout, não a seleção principal de família.
3. Font Catalog é uma capacidade global do Studio.
4. FontRef é preferível a string informal.
5. Display e Body são os primeiros roles obrigatórios/prioritários.
6. Provider inicial pode ser único.
7. Font Picker não é requisito para o primeiro render spike.
8. O spike deve respeitar a futura fronteira Font Resolver.
9. Preview e final devem usar a mesma fonte resolvida.
10. Final render não usa fallback silencioso.
11. Project-uploaded fonts podem entrar numa fase posterior.
12. Trocar tipografia no Project deve futuramente atualizar todas as peças compatíveis sem editar template.
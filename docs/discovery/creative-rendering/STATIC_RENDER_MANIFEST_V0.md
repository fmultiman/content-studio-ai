# StaticRenderManifest V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** contrato neutro para composição e render de uma peça visual estática


---


## 1. Objetivo


Definir um contrato simples, versionado e independente de renderer para transformar conteúdo estruturado, Project Identity compilada, assets e um template em um output visual estático.


Casos iniciais:


- slide de carrossel;
- post de feed;
- capa;
- thumbnail;
- card editorial;
- quote card;
- imagem de divulgação.


O contrato não representa um vídeo, não possui timeline e não deve ser modelado como VideoWork.


## 2. Relação com o domínio existente


Fluxo preferido:


~~~
Project
→ Production
→ EditorialContent
→ ChannelPiece
→ StaticRenderManifest
→ Render Execution
→ LibraryFile
→ ChannelPieceMedia
~~~


O manifest pode nascer de uma ChannelPiece, mas também pode existir temporariamente como draft de composição antes da associação final.


No V0, não é necessário decidir se StaticRenderManifest exige uma tabela própria.


## 3. Invariantes


1. O manifest é neutro em relação ao renderer.
2. O template é referenciado por id + versão.
3. O Project não é inferido pelo nome do template.
4. Conteúdo semântico fica separado do layout.
5. Assets são referências, não URLs soltas como fonte de verdade.
6. Dimensões e output são explícitos.
7. Identidade visual utilizada precisa ser reproduzível.
8. Overrides livres de CSS não fazem parte do V0.
9. O manifest deve ser validável por schema.
10. Um manifest válido deve poder ser renderizado por qualquer adapter compatível.


## 4. Estrutura V0


~~~
{
  "schema_version": "static-render.v0",
  "manifest_id": "...",


  "source": {
    "type": "channel_piece",
    "ref": "..."
  },


  "context": {
    "project_ref": "...",
    "production_ref": "..."
  },


  "template": {
    "id": "editorial.documentary-card",
    "version": "0.1.0",
    "variant": "cover",
    "scope": "system"
  },


  "canvas": {
    "width": 1080,
    "height": 1350,
    "unit": "px"
  },


  "identity": {
    "snapshot_ref": "...",
    "token_profile": "default"
  },


  "content": {},
  "assets": {},


  "output": {
    "format": "png",
    "role": "carousel_item"
  },


  "metadata": {}
}
~~~


## 5. Campos


### schema_version


Versão do contrato. Exemplo: static-render.v0.


Não corresponde à versão do template.


### manifest_id


Identidade do manifest ou fixture.


Pode ser UUID ou outro identificador interno.


### source


Explica por que a composição existe.


Tipos iniciais sugeridos:


~~~
channel_piece
editorial_content
production
manual
fixture
~~~


O campo ref pode ser omitido quando a origem ainda não foi persistida.


### context


Mantém relação com o domínio sem transportar todo o domínio para o renderer.


Campos V0:


~~~
project_ref
production_ref
~~~


Possíveis extensões futuras:


~~~
editorial_content_ref
channel_piece_ref
video_work_ref
~~~


### template


~~~
id
version
variant
scope
~~~


Scope:


~~~
system
project
~~~


System significa template disponível genericamente no produto.


Project significa template registrado para um Project por mecanismo genérico, sem hardcode no core.


### canvas


~~~
width
height
unit
~~~


V0 suporta unit = px.


Aspect ratio é derivável das dimensões e não precisa ser fonte paralela obrigatória.


### identity


Referência ao estado visual usado no render.


V0:


~~~
snapshot_ref
token_profile
~~~


O renderer resolve esse snapshot para Visual Tokens antes de executar o template.


### content


Objeto validado pelo schema de props do template.


Exemplo:


~~~
{
  "eyebrow": "Comunidade em foco",
  "title": "Terra Una",
  "subtitle": "...",
  "source_line": "..."
}
~~~


O core não interpreta cada chave de conteúdo. Quem valida essas chaves é o schema do template.


### assets


Mapa de slots de assets.


Exemplo:


~~~
{
  "hero": {
    "type": "library_file",
    "ref": "asset_123",
    "fit": "cover",
    "focal_point": {
      "x": 0.5,
      "y": 0.4
    }
  }
}
~~~


### output


Intenção de output.


Campos iniciais:


~~~
format
role
quality_profile?
transparent?
~~~


Formatos iniciais:


~~~
png
jpeg
webp
~~~


Role pode usar vocabulário compatível com ChannelPieceMedia quando fizer sentido.


### metadata


Espaço controlado para informações não visuais do manifest.


Exemplos:


~~~
fixture
notes
created_from
locale
~~~


Não usar metadata como depósito para configurações de renderer.


## 6. AssetRef V0


~~~
type AssetRef = {
  type:
    | "library_file"
    | "image"
    | "production_artifact"
    | "external"
    | "fixture";


  ref: string;
  version?: string;
  checksum?: string;


  fit?: "cover" | "contain" | "fill";


  focal_point?: {
    x: number;
    y: number;
  };


  alt?: string;
};
~~~


External deve ser usado com cautela. Produção real deve preferir assets internalizados ou rastreáveis.


## 7. CanvasSpec V0


~~~
type CanvasSpec = {
  width: number;
  height: number;
  unit: "px";
};
~~~


Validações:


- width > 0;
- height > 0;
- valores inteiros;
- limites máximos definidos pela infraestrutura;
- nenhuma inferência silenciosa por canal.


O canal pode sugerir um preset, mas o manifest final fixa dimensões.


## 8. TemplateRef V0


~~~
type TemplateRef = {
  id: string;
  version: string;
  variant?: string;
  scope: "system" | "project";
};
~~~


Regra: Template id identifica capacidade visual; nunca identifica implicitamente o Project.


Evitar templates hardcoded do core com nomes de projetos reais.


Preferir ids genéricos como:


~~~
editorial.documentary-card
editorial.quote-card
social.cover-card
~~~


Quando houver template realmente próprio de Project, ele entra pelo mecanismo genérico scope = project.


## 9. TypeScript conceitual


~~~
type StaticRenderManifest<TContent = unknown> = {
  schema_version: "static-render.v0";
  manifest_id: string;


  source: {
    type:
      | "channel_piece"
      | "editorial_content"
      | "production"
      | "manual"
      | "fixture";
    ref?: string;
  };


  context: {
    project_ref: string;
    production_ref?: string;
  };


  template: TemplateRef;
  canvas: CanvasSpec;


  identity: {
    snapshot_ref: string;
    token_profile?: string;
  };


  content: TContent;
  assets: Record<string, AssetRef>;


  output: {
    format: "png" | "jpeg" | "webp";
    role?: string;
    quality_profile?: string;
    transparent?: boolean;
  };


  metadata?: Record<string, unknown>;
};
~~~


Este é contrato conceitual, não código final.


O agente de implementação deve confrontar nomes e convenções com o repositório antes de criar arquivos.


## 10. O que não entra no manifest


Não colocar diretamente:


- JSX ou TSX;
- React component import;
- CSS arbitrário;
- className;
- Tailwind strings;
- Remotion composition id;
- Chromium flags;
- Lambda settings;
- worker URL;
- storage credentials;
- provider API keys;
- render timeout;
- FFmpeg flags.


Esses elementos pertencem ao adapter/execution plane.


## 11. Validação


Validação ocorre em duas etapas.


### Core schema


Confirma estrutura base, versões, canvas, refs, output e tipos gerais.


### Template schema


Confirma content props, asset slots, variantes, obrigatoriedade, limites textuais e capabilities.


Fluxo:


~~~
StaticRenderManifestSchema
        ↓
resolveTemplate()
        ↓
template content schema
        ↓
template asset schema
~~~


## 12. Overflow e conteúdo longo


O V0 não deve resolver overflow reduzindo fonte indefinidamente.


Templates devem declarar estratégia.


Possíveis políticas:


~~~
reject
truncate
fit_within_range
alternate_variant
human_review
~~~


O resultado da validação pode ser valid, warning ou invalid.


## 13. Render Execution


StaticRenderManifest é intenção reproduzível.


RenderExecution registra tentativa técnica.


Exemplo conceitual:


~~~
{
  execution_id,
  manifest_id,
  renderer,
  renderer_version,
  status,
  output_ref,
  warnings,
  technical_metadata
}
~~~


Falha de uma execution não invalida o manifest.


## 14. Output


Para mídia aprovada associada a uma ChannelPiece, o caminho preferido continua:


~~~
approved output
→ LibraryFile
→ ChannelPieceMedia
~~~


A relação exata entre render estático e ProductionArtifact deve ser decidida depois do spike, respeitando a arquitetura existente.


## 15. Primeiro template de validação


Template genérico:


~~~
editorial.documentary-card
~~~


Variant inicial:


~~~
cover
~~~


Slots de conteúdo sugeridos:


~~~
eyebrow?
title
subtitle?
source_line?
footer?
~~~


Asset principal:


~~~
hero
~~~


Logo deve preferencialmente ser resolvido pela identidade, não repetido em todo manifest.


O Portal Comunidades Alternativas usa esse template apenas como Project fixture.


## 16. Persistência V0


Não criar tabela específica inicialmente.


~~~
fixture JSON
→ schema validation
→ template resolution
→ preview
→ render
~~~


Depois avaliar se o manifest deve ser JSON de artifact, JSONB, entidade própria, parte de uma futura composição ou derivado persistido junto à execution.


## 17. Critérios de aceite


O contrato V0 está adequado se:


- não conhece Remotion;
- não conhece Portal;
- representa um slide real;
- fixa template e identidade;
- possui schema validável;
- separa conteúdo de design;
- suporta assets rastreáveis;
- gera output determinístico quando inputs e versões permanecem iguais.
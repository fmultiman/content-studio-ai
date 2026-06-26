-- Migration: 028_m11f_project_identity_migration.sql
-- Marco: M11-F — Migração de dados de Project Identity V1
-- Data: 2026-06-26
-- Aplicar via: Supabase SQL Editor ou psql (POSTGRES_URL_NON_POOLING)
--
-- Escopo:
--   Alquimia Cibernética (0b04df8b): identity preenchida a partir de context + style_profile
--   Content Agent (d0d008c3): sem alteração — dados insuficientes
--   Projeto teste (6d09d50d): identity → NULL (cleanup de dados do smoke M11-E)
--
-- Rollback:
--   UPDATE projects SET identity = NULL WHERE id = '0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187';
--   UPDATE projects SET identity = NULL WHERE id = '6d09d50d-f4dd-4651-ba46-d6705aa3a385';
--
-- Campos preservados: context, style_profile, evaluation_mode (intocados)

-- ─── Alquimia Cibernética ────────────────────────────────────────────────────

UPDATE projects
SET identity = '{
  "schema_version": 1,
  "foundation": {
    "purpose": "Plataforma de curadoria técnica e inteligência cultural que realiza engenharia reversa de tradições ancestrais e sistemas simbólicos, tratando espiritualidade e cultura como tecnologias de governança da consciência. Recruta o espectador para um território de arqueologia cognitiva, onde o passado funciona como código-fonte para resolver falhas de execução do presente."
  },
  "relationship": {
    "audience": "Criadores, pensadores e pessoas interessadas na interseção entre tecnologia, cultura, simbolismo e análise crítica — públicos que buscam profundidade intelectual e rejeitam conteúdo superficial ou genérico."
  },
  "expression": {
    "visual_identity": "Fusão entre sistemas ancestrais (rituais, símbolos, mitologia) e estruturas tecnológicas contemporâneas (interface, comportamento, código). Estética simbólica, densa, cinematográfica e conceitual. Sensação de mistério, profundidade e arqueologia cognitiva. Ambiguidade interpretativa intencional.",
    "voice": "Técnica e acessível. Usa metáforas de engenharia, código e sistemas para tratar espiritualidade e cultura como tecnologias analisáveis. Estruturada em três eixos: Eixo A (O Código — engenharia reversa de mitos e rituais), Eixo B (A UX da Vida — diagnóstico de fricções comportamentais), Hibridismo (O Debug — aplicação de protocolos ancestrais ao presente)."
  },
  "governance": {
    "principles": [
      "Profundidade conceitual e simbólica em toda execução",
      "Tratar cultura e espiritualidade como sistemas analisáveis, não como mística vaga",
      "Conectar tradição e contemporaneidade sem simplificação",
      "Priorizar leitura simbólica, profundidade e ambiguidade interpretativa"
    ],
    "restrictions": [
      "Evitar aparência genérica ou clichê visual",
      "Evitar estética clean ou corporativa",
      "Evitar representações literais simples sem profundidade simbólica",
      "Evitar misticismo vago ou linguagem de autoajuda superficial",
      "Evitar clichês visuais de espiritualidade sem contexto simbólico"
    ]
  },
  "practice": {
    "generation_preferences": [
      "Iluminação dramática e alto contraste",
      "Estética cinematográfica",
      "Atmosfera densa",
      "Composição forte e centralizada quando coerente",
      "Elementos abstratos e conceituais",
      "Fusão visual entre tecnologia e simbolismo ancestral"
    ]
  }
}'::jsonb
WHERE id = '0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187';

-- ─── Projeto teste — cleanup ─────────────────────────────────────────────────

UPDATE projects
SET identity = NULL
WHERE id = '6d09d50d-f4dd-4651-ba46-d6705aa3a385';

-- ─── Verificação pós-migração ────────────────────────────────────────────────
-- Execute após o UPDATE para confirmar:
--
-- SELECT
--   id,
--   name,
--   identity IS NOT NULL  AS has_identity,
--   identity->>'schema_version' AS schema_version,
--   context IS NOT NULL   AS has_context,
--   style_profile IS NOT NULL AS has_style_profile,
--   evaluation_mode,
--   updated_at
-- FROM projects
-- WHERE id IN (
--   '0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187',
--   'd0d008c3-321b-46fe-8225-2f1a68e833ec',
--   '6d09d50d-f4dd-4651-ba46-d6705aa3a385'
-- )
-- ORDER BY name;
--
-- Esperado:
--   Alquimia Cibernética: has_identity=true, schema_version=1, context e style_profile intactos
--   Content Agent:        has_identity=false (NULL — sem alteração)
--   Projeto teste:        has_identity=false (NULL — cleanup)

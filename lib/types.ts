// Database types for Content Agent Studio

import type { ProjectIdentity } from '@/lib/schemas/project-identity'

export interface Project {
  id: string
  user_id: string
  name: string
  description: string | null
  context: string | null
  evaluation_mode: EvaluationMode
  identity: ProjectIdentity | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export type EvaluationMode = 'default' | 'conceptual' | 'aesthetic' | 'commercial' | 'experimental'

export type ProductionType = 'editorial' | 'branding' | 'campaign'

export interface Production {
  id: string
  user_id: string
  project_id: string
  title: string
  intention: string
  type: ProductionType
  created_at: string
  updated_at: string
}

export interface UserSettings {
  id: string
  user_id: string
  theme: 'light' | 'dark' | 'system' | 'studio'
  studio_intensity: 'soft' | 'balanced' | 'expressive'
  auto_mode_default: boolean
  save_prompt_history: boolean
  notifications_email: boolean
  notifications_browser: boolean
  openai_api_key: string | null
  replicate_api_key: string | null
  nanobanana_api_key: string | null
  nanobanana_base_url: string | null
  automation_enabled: boolean
  default_image_model: 'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini' | 'nanobanana-v1' | 'nanobanana-v2'
  image_evaluator_enabled: boolean
  max_refinement_iterations: number
  created_at: string
  updated_at: string
}

// Evaluation types
export interface ImageEvaluation {
  score: number
  approved: boolean
  feedback: string
  improvements: string[]
  refinedPrompt: string
}

export interface GenerationAttempt {
  id: string
  attempt: number
  prompt: string
  imageUrl: string | null
  imageId?: string | null
  model: string
  evaluation: ImageEvaluation | null
  timestamp: string
}

export interface Image {
  id: string
  user_id: string
  project_id: string | null
  user_input: string
  generated_prompt: string | null
  image_url: string | null
  thumbnail_url?: string | null
  storage_provider?: string | null
  storage_path?: string | null
  thumbnail_path?: string | null
  file_size?: number | null
  mime_type?: string | null
  status: 'draft' | 'generating' | 'approved' | 'rejected'
  model: string | null
  aspect_ratio: string | null
  style: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Prompt {
  id: string
  user_id: string
  original_input: string
  generated_prompt: string
  type: 'image' | 'video'
  is_favorite: boolean
  tags: string[] | null
  created_at: string
}

export interface Video {
  id: string
  user_id: string
  project_id: string | null
  name: string
  description: string | null
  status: 'draft' | 'generating' | 'completed' | 'failed'
  video_url: string | null
  duration_seconds: number | null
  scenes: VideoScene[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PublicationType =
  | 'instagram_post'
  | 'instagram_story'
  | 'youtube_post'
  | 'youtube_shorts'
  | 'youtube_video'
export type PostStatus = 'draft' | 'saved'

export interface Post {
  id: string
  user_id: string
  project_id: string | null
  production_id: string | null
  name: string
  channel: PublicationType
  description: string | null
  ai_context: string | null
  feed_text: string | null
  image_url: string | null
  thumbnail_url?: string | null
  storage_provider?: string | null
  storage_path?: string | null
  thumbnail_path?: string | null
  file_size?: number | null
  mime_type?: string | null
  post_images?: PostImage[] | null
  status: PostStatus
  created_at: string
  updated_at: string
  migrated_at?: string | null
  // computed by GET /api/posts when migrated_at IS NOT NULL — not stored in posts table
  migrated_ec_id?: string | null
  migrated_ec_project_id?: string | null
}

export interface PostImage {
  id: string
  imageUrl: string
  thumbnailUrl: string
  storageProvider: string | null
  storagePath: string | null
  thumbnailPath: string | null
  fileSize: number | null
  mimeType: string | null
  name?: string | null
}

export type LibraryFileKind = 'image' | 'video' | 'audio' | 'document' | 'other'

export interface LibraryFile {
  id: string
  user_id: string
  project_id: string | null
  folder: string
  name: string
  kind: LibraryFileKind
  mime_type: string | null
  file_size: number | null
  storage_provider: string
  storage_path: string
  public_url: string
  thumbnail_url: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface LibraryFolder {
  id: string
  user_id: string
  project_id: string
  name: string
  path: string
  parent_path: string
  is_project_root: boolean
  created_at: string
  updated_at: string
}

export interface VideoScene {
  id: string
  order: number
  description: string
  prompt: string | null
  image_url: string | null
  /** Optional persistent identity of the scene's primary LibraryFile asset. */
  library_file_id?: string | null
  duration: number // in seconds
  movement: string | null
}

// Form types
export interface CreateProjectForm {
  name: string
  description: string
  context: string
  evaluation_mode: EvaluationMode
}

export interface CreateImageForm {
  user_input: string
  project_id?: string
  auto_mode: boolean
}

// Draft types
export interface ImageDraft {
  id: string
  user_id: string
  project_id: string | null
  name: string | null
  user_input: string
  generated_prompt: string | null
  generated_prompt_pt?: string | null
  prompt_details?: {
    style: string
    lighting: string
    composition: string
  } | null
  current_evaluation?: ImageEvaluation | null
  generation_attempts?: GenerationAttempt[] | null
  current_attempt?: number | null
  image_status?: 'draft' | 'generating' | 'approved' | 'rejected' | null
  auto_mode: boolean
  image_url: string | null
  current_image_id?: string | null
  selected_model: 'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini' | 'nanobanana-v1' | 'nanobanana-v2' | null
  production_id: string | null
  created_at: string
  updated_at: string
}

export interface VideoDraft {
  id: string
  user_id: string
  project_id: string | null
  production_id: string | null
  name: string
  scenes: VideoScene[]
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Render execution (Phase 2I-B1) — see
// docs/productization/creative-rendering/PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md
// ---------------------------------------------------------------------------

export type RenderExecutionStatus = 'queued' | 'claimed' | 'completed' | 'failed'

/** User-safe projection only — never includes claimed_by, lease_expires_at,
 * input_snapshot, or error_detail (all internal-only, see B0 §16/§17). */
export interface RenderExecutionSummary {
  id: string
  /** Static Render Worker V1 (migration 034). Absent on older API payloads = 'video'. */
  kind?: 'video' | 'static_still'
  /** Non-null for kind 'video'; null for 'static_still' (DB CHECK enforced). */
  video_draft_id: string | null
  /** Non-null for kind 'static_still'. */
  channel_piece_id?: string | null
  status: RenderExecutionStatus
  attempt: number
  queued_at: string
  claimed_at: string | null
  completed_at: string | null
  failed_at: string | null
  output_mime_type: string | null
  output_size_bytes: number | null
  output_duration_ms: number | null
  output_width?: number | null
  output_height?: number | null
  /** Static only: safe projection of the frozen snapshot's slide reference. */
  slide?: { id: string; index: number; total: number } | null
  error_code: string | null
  error_message: string | null
}

// ---------------------------------------------------------------------------
// Publication domain types (P1 — PUBLICATION_DOMAIN_DECISIONS.md Rev. 2)
// ---------------------------------------------------------------------------

export type PublicationChannel =
  | 'instagram'
  | 'youtube'
  | 'whatsapp'
  | 'linkedin'
  | 'x'
  | 'tiktok'

export type PublicationFormat =
  | 'feed'
  | 'story'
  | 'reel'
  | 'short'
  | 'video_description'
  | 'post'
  | 'channel_message'
  | 'carousel'
  | 'article'

export type EditorialContentStatus = 'draft' | 'ready' | 'archived'

export type ChannelPieceStatus = 'draft' | 'ready' | 'approved' | 'archived'

export interface EditorialContent {
  id: string
  user_id: string
  project_id: string
  production_id: string | null
  title: string
  body: string | null
  ai_context: string | null
  status: EditorialContentStatus
  created_at: string
  updated_at: string
  legacy_post_id: string | null
}

export interface ChannelPiece {
  id: string
  user_id: string
  editorial_content_id: string
  channel: PublicationChannel
  format: PublicationFormat
  title: string | null
  body: string | null
  cta: string | null
  hashtags: string | null
  status: ChannelPieceStatus
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// ChannelPieceMedia types (M1 — CHANNEL_PIECE_MEDIA_DECISIONS.md Rev.2)
// ---------------------------------------------------------------------------

export type ChannelPieceMediaRole =
  | 'primary'
  | 'thumbnail'
  | 'carousel_item'
  | 'background'
  | 'attachment'

// Registro persistido — campos do banco exatamente como armazenados.
// Invariante: exatamente um de image_id / library_file_id é não-nulo
// (garantido por cpm_exactly_one_source no banco).
export interface ChannelPieceMedia {
  id: string
  user_id: string
  channel_piece_id: string
  image_id: string | null
  library_file_id: string | null
  position: number
  role: ChannelPieceMediaRole
  alt_text: string | null
  created_at: string
  updated_at: string
}

// Resposta enriquecida da API — inclui campos resolvidos via JOIN nas
// entidades de origem (images ou library_files). Calculados no handler,
// nunca persistidos em channel_piece_media.
export interface ChannelPieceMediaResolved extends ChannelPieceMedia {
  media_kind: LibraryFileKind | 'image'
  image_url: string | null
  thumbnail_url: string | null
  file_size: number | null
  mime_type: string | null
  name: string | null
  source_deleted: boolean  // true se library_files.deleted_at IS NOT NULL
}

// ---------------------------------------------------------------------------
// ChannelPieceStaticAuthoringState (Portal Carousel V1 — Slice 1)
// Ordered persisted static-authoring slides for a ChannelPiece. `slides` is
// validated in TypeScript by StaticAuthoringStateSchema
// (lib/creative/authoring/carousel-state.ts) — the DB only enforces a
// non-empty JSON array. See scripts/033_create_channel_piece_static_authoring_states.sql.
// ---------------------------------------------------------------------------

export interface ChannelPieceStaticAuthoringStateRow {
  id: string
  user_id: string
  channel_piece_id: string
  schema_version: string
  slides: unknown[]
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// API Response types
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

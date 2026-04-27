// Database types for Content Agent Studio

export interface Project {
  id: string
  user_id: string
  name: string
  description: string | null
  context: string | null
  style_profile: string | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface UserSettings {
  id: string
  user_id: string
  theme: 'light' | 'dark' | 'system'
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
  duration: number // in seconds
  movement: string | null
}

// Form types
export interface CreateProjectForm {
  name: string
  description: string
  context: string
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
  created_at: string
  updated_at: string
}

export interface VideoDraft {
  id: string
  user_id: string
  project_id: string | null
  name: string
  scenes: VideoScene[]
  created_at: string
  updated_at: string
}

// API Response types
export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

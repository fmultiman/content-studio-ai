import type { z } from 'zod'
import {
  DocumentaryCardCoverAssetsSchema,
  DocumentaryCardCoverContentSchema,
  DocumentaryCardInfoAssetsSchema,
  DocumentaryCardInfoContentSchema,
} from '@/lib/schemas/creative/documentary-card'
import { TemplateDescriptorSchema, type TemplateDescriptor } from '@/lib/schemas/creative/template-descriptor'
import type { AssetRef, CanvasSpec, MotionSpec, TemplateRef } from '@/lib/schemas/creative/primitives'

export type TemplateRegistryErrorCode =
  | 'template_not_found'
  | 'template_version_not_found'
  | 'variant_not_supported'
  | 'canvas_not_supported'
  | 'content_invalid'
  | 'asset_binding_invalid'
  | 'motion_not_supported'

export type TemplateRegistryError = {
  code: TemplateRegistryErrorCode
  message: string
  path?: string
  issues?: z.ZodIssue[]
}

export type TemplateRegistryResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: TemplateRegistryError }

type BindingSchemas = {
  content: z.ZodTypeAny
  assets: z.ZodTypeAny
}

export type TemplateRuntimeMode = 'still' | 'video'

export type RegisteredTemplate = {
  descriptor: TemplateDescriptor
  variants: Record<string, BindingSchemas>
}

export type ResolvedTemplate = {
  ref: Required<TemplateRef>
  descriptor: TemplateDescriptor
}

export type TemplateBindingSchemas = {
  content: z.ZodTypeAny
  assets: z.ZodTypeAny
}

const documentaryCardDescriptor = TemplateDescriptorSchema.parse({
  id: 'editorial.documentary-card',
  version: '0.1.0',
  scope: 'system',
  label: 'Editorial Documentary Card',
  supported_modes: ['still', 'video'],
  variants: ['cover', 'info'],
  canvas_support: {
    strategy: 'declared_sizes',
    sizes: [
      { width: 1080, height: 1350, unit: 'px' },
      { width: 1080, height: 1920, unit: 'px' },
    ],
  },
  schemas: {
    content: 'editorial.documentary-card.content.v0',
    assets: 'editorial.documentary-card.assets.v0',
  },
  capabilities: {
    motion_presets: ['none', 'fade', 'slow_push', 'slow_pan'],
    supports_transparency: false,
  },
  identity_requirements: ['typography.display', 'typography.body', 'colors.background', 'colors.foreground'],
  text_policy: { default_overflow_policy: 'human_review' },
  component_key: 'editorial.documentary-card',
})

const TEMPLATE_REGISTRY: readonly RegisteredTemplate[] = [
  {
    descriptor: documentaryCardDescriptor,
    variants: {
      cover: {
        content: DocumentaryCardCoverContentSchema,
        assets: DocumentaryCardCoverAssetsSchema,
      },
      info: {
        content: DocumentaryCardInfoContentSchema,
        assets: DocumentaryCardInfoAssetsSchema,
      },
    },
  },
]

function fail(code: TemplateRegistryErrorCode, message: string, path?: string, issues?: z.ZodIssue[]): TemplateRegistryResult<never> {
  return { valid: false, error: { code, message, path, issues } }
}

function sameCanvas(a: CanvasSpec, b: CanvasSpec): boolean {
  return a.width === b.width && a.height === b.height && a.unit === b.unit
}

function supportsCanvas(descriptor: TemplateDescriptor, canvas: CanvasSpec): boolean {
  const support = descriptor.canvas_support
  if (support.strategy === 'fixed') return sameCanvas(support.size, canvas)
  if (support.strategy === 'declared_sizes') return support.sizes.some((size) => sameCanvas(size, canvas))

  return (
    (support.min_width === undefined || canvas.width >= support.min_width) &&
    (support.max_width === undefined || canvas.width <= support.max_width) &&
    (support.min_height === undefined || canvas.height >= support.min_height) &&
    (support.max_height === undefined || canvas.height <= support.max_height)
  )
}

export function listTemplates(): readonly TemplateDescriptor[] {
  return TEMPLATE_REGISTRY.map((entry) => entry.descriptor)
}

export function resolveTemplate(ref: TemplateRef): TemplateRegistryResult<ResolvedTemplate> {
  const scoped = TEMPLATE_REGISTRY.filter((entry) => entry.descriptor.id === ref.id && entry.descriptor.scope === ref.scope)
  if (scoped.length === 0) {
    return fail('template_not_found', `Template "${ref.id}" with scope "${ref.scope}" is not registered`, 'template')
  }

  const registered = scoped.find((entry) => entry.descriptor.version === ref.version)
  if (!registered) {
    return fail('template_version_not_found', `Template "${ref.id}" does not have version "${ref.version}"`, 'template.version')
  }

  if (!ref.variant || !registered.descriptor.variants.includes(ref.variant)) {
    return fail('variant_not_supported', `Variant "${ref.variant ?? '(missing)'}" is not supported by "${ref.id}@${ref.version}"`, 'template.variant')
  }

  return {
    valid: true,
    value: {
      ref: { ...ref, variant: ref.variant },
      descriptor: registered.descriptor,
    },
  }
}

function findRegisteredTemplate(resolved: ResolvedTemplate): RegisteredTemplate {
  const registered = TEMPLATE_REGISTRY.find(
    (entry) =>
      entry.descriptor.id === resolved.ref.id &&
      entry.descriptor.version === resolved.ref.version &&
      entry.descriptor.scope === resolved.ref.scope,
  )
  if (!registered) throw new Error('Resolved template is absent from the static registry')
  return registered
}

export function selectTemplateBindingSchemas(
  resolved: ResolvedTemplate,
): TemplateRegistryResult<TemplateBindingSchemas> {
  return { valid: true, value: findRegisteredTemplate(resolved).variants[resolved.ref.variant] }
}

export function validateTemplateContent(resolved: ResolvedTemplate, content: unknown): TemplateRegistryResult<Record<string, unknown>> {
  const schema = findRegisteredTemplate(resolved).variants[resolved.ref.variant].content
  const parsed = schema.safeParse(content)
  if (!parsed.success) {
    return fail('content_invalid', `Content is invalid for variant "${resolved.ref.variant}"`, 'content', parsed.error.issues)
  }
  return { valid: true, value: parsed.data as Record<string, unknown> }
}

export function validateTemplateAssetBindings(
  resolved: ResolvedTemplate,
  assets: Record<string, AssetRef>,
): TemplateRegistryResult<Record<string, AssetRef>> {
  const schema = findRegisteredTemplate(resolved).variants[resolved.ref.variant].assets
  const parsed = schema.safeParse(assets)
  if (!parsed.success) {
    return fail('asset_binding_invalid', `Asset bindings are invalid for variant "${resolved.ref.variant}"`, 'assets', parsed.error.issues)
  }
  return { valid: true, value: parsed.data as Record<string, AssetRef> }
}

export function validateTemplateCanvas(resolved: ResolvedTemplate, canvas: CanvasSpec): TemplateRegistryResult<CanvasSpec> {
  if (!supportsCanvas(resolved.descriptor, canvas)) {
    return fail(
      'canvas_not_supported',
      `Canvas ${canvas.width}x${canvas.height}px is not supported by "${resolved.ref.id}@${resolved.ref.version}"`,
      'canvas',
    )
  }
  return { valid: true, value: canvas }
}

export function validateTemplateMode(
  resolved: ResolvedTemplate,
  mode: TemplateRuntimeMode,
): TemplateRegistryResult<TemplateRuntimeMode> {
  if (!resolved.descriptor.supported_modes.includes(mode)) {
    return fail('motion_not_supported', `Mode "${mode}" is not supported by "${resolved.ref.id}@${resolved.ref.version}"`, 'mode')
  }
  return { valid: true, value: mode }
}

export function validateTemplateMotion(
  resolved: ResolvedTemplate,
  motion: MotionSpec | undefined,
): TemplateRegistryResult<MotionSpec | undefined> {
  if (motion && !resolved.descriptor.capabilities.motion_presets.includes(motion.preset)) {
    return fail(
      'motion_not_supported',
      `Motion preset "${motion.preset}" is not supported by "${resolved.ref.id}@${resolved.ref.version}"`,
      'motion.preset',
    )
  }
  return { valid: true, value: motion }
}

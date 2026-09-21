import { z } from 'zod'
import type { AssetRef } from '@/lib/schemas/creative/primitives'

export const PrimitiveValidationSchema = z.object({
  mime_type: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  has_alpha: z.literal(true),
  file_size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()

export const PrimitiveDescriptorSchema = z.object({
  key: z.string().trim().min(1),
  version: z.string().trim().min(1),
  scope: z.literal('project'),
  project_ref: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  pack_key: z.string().trim().min(1),
  pack_version: z.string().trim().min(1),
  category: z.enum(['paper', 'tape']),
  library_file_ref: z.string().uuid(),
  allowed_roles: z.array(z.literal('decoration')).min(1),
  placeable: z.literal(true),
  origin: z.enum(['generated', 'system_curated', 'project_upload', 'external_licensed', 'derived']),
  license_class: z.string().trim().min(1),
  provenance: z.string().trim().min(1),
  validation: PrimitiveValidationSchema,
}).strict()

export type PrimitiveDescriptor = z.infer<typeof PrimitiveDescriptorSchema>

export type ProjectPrimitiveCatalog = {
  project_ref: string
  pack_key: string
  pack_version: string
  descriptors: Readonly<Record<string, PrimitiveDescriptor>>
}

export type PrimitiveSelection = {
  descriptor: PrimitiveDescriptor
  asset_ref: AssetRef
}

export function createProjectPrimitiveCatalog(input: {
  project_ref: string
  pack_key: string
  pack_version: string
  descriptors: readonly PrimitiveDescriptor[]
}): ProjectPrimitiveCatalog {
  const descriptors = input.descriptors.map((descriptor) => PrimitiveDescriptorSchema.parse(descriptor))
  const keys = new Set<string>()
  for (const descriptor of descriptors) {
    if (descriptor.project_ref !== input.project_ref) throw new Error(`Primitive "${descriptor.key}" belongs to another project`)
    if (descriptor.pack_key !== input.pack_key || descriptor.pack_version !== input.pack_version) {
      throw new Error(`Primitive "${descriptor.key}" does not match catalog pack identity`)
    }
    if (keys.has(descriptor.key)) throw new Error(`Duplicate primitive key "${descriptor.key}"`)
    keys.add(descriptor.key)
  }

  return {
    project_ref: input.project_ref,
    pack_key: input.pack_key,
    pack_version: input.pack_version,
    descriptors: Object.fromEntries(descriptors.map((descriptor) => [descriptor.key, descriptor])),
  }
}

export function selectProjectPrimitive(catalog: ProjectPrimitiveCatalog, key: string): PrimitiveSelection {
  const descriptor = catalog.descriptors[key]
  if (!descriptor) throw new Error(`Unknown project primitive "${key}"`)

  return {
    descriptor,
    asset_ref: {
      type: 'library_file',
      ref: descriptor.library_file_ref,
      version: descriptor.version,
      ...(descriptor.validation.sha256 ? { checksum: descriptor.validation.sha256 } : {}),
    },
  }
}


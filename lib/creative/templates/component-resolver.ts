import type { ComponentType } from 'react'
import { DocumentaryCard } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'

export type ResolvedTemplateComponent = ComponentType<DocumentaryCardProps>

export function resolveTemplateComponent(componentKey: string): ResolvedTemplateComponent | undefined {
  if (componentKey === 'editorial.documentary-card') return DocumentaryCard
  return undefined
}

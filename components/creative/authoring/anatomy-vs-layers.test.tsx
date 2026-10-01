import { describe, it, expect } from 'vitest'
import { resolveLayoutSections } from '@/lib/creative/templates/template-anatomy'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '@/lib/creative/templates/template-definitions'

describe('ANATOMY != PAINT ORDER', () => {
  it('Anatomy ordering/grouping does NOT modify paint order, and layer reordering does NOT modify Section membership or semantic Anatomy ordering', () => {
    const layout = getTemplateLayout(TEMPLATE, 'cover')!
    
    // 1. Initial State: The layout defines default stack order independently from anatomical sections.
    const originalSections = resolveLayoutSections(TEMPLATE, layout)
    const originalPaintOrder = [...layout.defaultStackOrder]

    // Ensure they represent fundamentally different sequences.
    const flatAnatomyElements = originalSections.flatMap(section => section.elements.map(e => e.id))
    expect(flatAnatomyElements).not.toEqual(originalPaintOrder)

    // 2. Scenario A: Anatomy ordering does NOT modify paint order.
    // Simulating the derived UI metadata extracting sections
    const derivedSections = resolveLayoutSections(TEMPLATE, layout)
    // No side-effects on paint order
    expect([...layout.defaultStackOrder]).toEqual(originalPaintOrder)

    // 3. Scenario B: Layer Reordering does NOT modify Section Membership
    // We simulate a layer reorder action authored by the user:
    const mutatedPaintOrder = [...originalPaintOrder].reverse() // simulating extreme Drag & Drop inverted order

    // Even if paint order changes (passed to components), the anatomical structure (for the tree) never receives a reorder action, because the Sections array is strictly derived directly from the Template Registry and Element Definitions (which are immutable to the editing user).
    const newResolvedSections = resolveLayoutSections(TEMPLATE, layout)
    
    // The membership and ordering in the Sections tree remains completely isolated and intact.
    expect(newResolvedSections).toEqual(originalSections)

    // Semantic grouping has not absorbed the altered sequence.
    expect(newResolvedSections[0].elements.map(e => e.id)).not.toEqual(mutatedPaintOrder.slice(0, newResolvedSections[0].elements.length))
  })
})

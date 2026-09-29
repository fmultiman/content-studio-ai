import { describeGenerationProvenance } from '@/lib/video-generation/connection-presentation'

// VIDEO_GENERATION_MODAL_SAFETY_AND_TRANSPORT_UX_V1
//
// One quiet line in a generation's history card: was it made through the Kling
// API or through the user's Kling account (MCP), and on which connection.

export function GenerationProvenance({
  generation,
  connectionNames,
}: {
  generation: { transport?: string | null; connection_id?: string | null }
  connectionNames: ReadonlyMap<string, string>
}) {
  const { badge, connectionName } = describeGenerationProvenance(generation, connectionNames)
  return (
    <p
      className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"
      data-testid="generation-provenance"
      data-transport={badge}
    >
      <span
        className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
        data-testid="generation-transport-badge"
      >
        {badge}
      </span>
      <span>{connectionName ?? 'Kling'}</span>
    </p>
  )
}

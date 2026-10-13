import { describeGenerationProvenance } from '@/lib/video-generation/connection-presentation'
import { describeFrameProvenance } from '@/lib/video-generation/frames'

// VIDEO_GENERATION_MODAL_SAFETY_AND_TRANSPORT_UX_V1
//
// One quiet line in a generation's history card: was it made through the Kling
// API, through the user's Kling account (MCP) or through Google Veo, and on which connection.
//
// VEO_KLING_FIRST_LAST_FRAME_V1: when the attempt was made from a FIRST and a LAST frame, a second line says so. The
// provenance comes from the attempt's immutable request_config (durable ids), never from a temporary URL.

export function GenerationProvenance({
  generation,
  connectionNames,
}: {
  generation: { transport?: string | null; connection_id?: string | null; provider?: string | null; request_config?: Record<string, unknown> | null }
  connectionNames: ReadonlyMap<string, string>
}) {
  const { badge, connectionName } = describeGenerationProvenance(generation, connectionNames)
  const frames = describeFrameProvenance(generation)
  return (
    <>
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
      {frames && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="generation-frames-provenance">
          {frames}
        </p>
      )}
    </>
  )
}

import { StatusBadge } from '@/components/ui/status-badge'
import { describeGenerationStatus } from '@/lib/video-generation/status-presentation'

// STRUCTURAL_WAVE_0 (D9): the one badge for a video generation's stored status (hub, Production, workspace history).
// `data-status` keeps the untouched stored value inspectable; the visible text is the pt-BR label.
export function GenerationStatusBadge({ status }: { status: string | null | undefined }) {
  const { label, tone } = describeGenerationStatus(status)
  return (
    <span data-testid="generation-status" data-status={status ?? ''} className="inline-flex">
      <StatusBadge label={label} tone={tone} />
    </span>
  )
}

'use client'

// VIDEO_REVIEW_UI_AND_HISTORY_V1
//
// One Video Review, readable without raw JSON. Purely presentational: it renders what the history read returned
// and performs no request and no mutation. Review is ADVISORY: nothing here approves, blocks, applies or edits.
//
//  - criteria with applicable=false or insufficient_evidence are shown as such (never as a failure);
//  - the refined prompt is a SUGGESTION and is only displayed;
//  - the analysis is visual-only and the UI never implies audio was evaluated.

import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  ASSESSMENT_LABEL,
  ASSESSMENT_TONE,
  describeFailureCode,
  isInFlightReview,
  isStaleInFlightReview,
  VIDEO_REVIEW_STALE_MINUTES,
} from '@/lib/reviews/video-review-presentation'
import type { ReviewCriterionV1 } from '@/lib/reviews/contracts'
import type { VideoReviewHistoryItem } from '@/lib/reviews/video-review-dto'

function formatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function BulletList({ title, items, testId }: { title: string; items: string[]; testId: string }) {
  if (!items.length) return null
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-xs font-medium text-text-secondary">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="break-words">{item}</li>
        ))}
      </ul>
    </div>
  )
}

function Criterion({ criterion }: { criterion: ReviewCriterionV1 }) {
  const notApplicable = !criterion.applicable
  const insufficient = criterion.applicable && criterion.assessment === 'insufficient_evidence'
  return (
    <li className="space-y-1 rounded-md border border-border-subtle p-3" data-testid={`review-criterion-${criterion.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-medium">{criterion.label}</span>
        {notApplicable ? (
          <Badge variant="neutral" data-testid={`review-criterion-${criterion.key}-state`}>Não se aplica</Badge>
        ) : insufficient ? (
          <Badge variant="neutral" data-testid={`review-criterion-${criterion.key}-state`}>Evidência insuficiente</Badge>
        ) : (
          <span className="flex items-center gap-2" data-testid={`review-criterion-${criterion.key}-state`}>
            {criterion.score !== null && <span className="text-xs text-text-secondary">{criterion.score}/100</span>}
            {criterion.assessment && <Badge variant={ASSESSMENT_TONE[criterion.assessment]}>{ASSESSMENT_LABEL[criterion.assessment]}</Badge>}
          </span>
        )}
      </div>
      {!notApplicable && criterion.evidence.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {criterion.evidence.map((line, index) => (
            <li key={`${index}-${line}`} className="break-words">{line}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function VideoReviewResult({
  item,
  position,
  total,
  nowMs,
}: {
  item: VideoReviewHistoryItem
  /** 1-based position counting from the OLDEST Review. */
  position: number
  total: number
  nowMs: number
}) {
  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-text-secondary" data-testid="review-position">
        Revisão {position} de {total} · {formatDate(item.completedAt ?? item.createdAt)}
      </p>
      {item.evaluator.model && (
        <span className="text-xs text-text-secondary" data-testid="review-evaluator">
          {item.evaluator.provider === 'gemini' ? 'Gemini' : item.evaluator.provider} · {item.evaluator.model}
        </span>
      )}
    </div>
  )

  if (isInFlightReview(item)) {
    const stale = isStaleInFlightReview(item, nowMs)
    return (
      <div className="space-y-2 rounded-lg border border-border-subtle p-4" data-testid={`review-item-${item.id}`} data-status={item.status}>
        {heading}
        <p className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {item.status === 'pending' ? 'Revisão na fila…' : 'Revisão em andamento…'}
        </p>
        {stale && (
          <p className="text-xs text-text-secondary" data-testid="review-stale-note">
            Esta revisão foi iniciada há mais de {VIDEO_REVIEW_STALE_MINUTES} minutos e pode ter sido interrompida. Ao revisar novamente, ela será encerrada e uma nova revisão começará.
          </p>
        )}
      </div>
    )
  }

  if (item.status === 'failed' || !item.result) {
    return (
      <div className="space-y-2 rounded-lg border border-border-subtle p-4" data-testid={`review-item-${item.id}`} data-status="failed">
        {heading}
        <div className="flex items-center gap-2">
          <Badge variant="destructive">Falhou</Badge>
          <p className="min-w-0 break-words text-sm" data-testid="review-failure">
            {describeFailureCode(item.failure?.code ?? '')}
          </p>
        </div>
      </div>
    )
  }

  const { result } = item
  return (
    <article className="space-y-4 rounded-lg border border-border-subtle p-4" data-testid={`review-item-${item.id}`} data-status="completed">
      {heading}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold" data-testid="review-score">{result.overall.score}<span className="text-sm font-normal text-text-secondary">/100</span></span>
        <Badge variant={ASSESSMENT_TONE[result.overall.assessment]} data-testid="review-assessment">{ASSESSMENT_LABEL[result.overall.assessment]}</Badge>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm" data-testid="review-summary">{result.summary}</p>

      {result.analyzed === 'visual_only' && (
        <p className="text-xs text-text-secondary" data-testid="review-visual-only">
          Análise somente visual: o áudio do vídeo não foi avaliado.
        </p>
      )}

      {result.criteria.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">Critérios</p>
          <ul className="space-y-2">
            {result.criteria.map((criterion) => <Criterion key={criterion.key} criterion={criterion} />)}
          </ul>
        </div>
      )}

      <BulletList title="Pontos fortes" items={result.strengths} testId="review-strengths" />
      <BulletList title="Problemas encontrados" items={result.issues} testId="review-issues" />
      <BulletList title="Recomendações" items={result.recommendations} testId="review-recommendations" />

      {result.refinedPrompt && (
        <div className="space-y-1 rounded-md border border-dashed border-border-default p-3" data-testid="review-refined-prompt">
          <p className="text-xs font-medium text-text-secondary">Sugestão de prompt</p>
          <p className="whitespace-pre-wrap break-words text-sm">{result.refinedPrompt}</p>
          <p className="text-xs text-text-secondary">É apenas uma sugestão: nada é alterado nem gerado automaticamente.</p>
        </div>
      )}
    </article>
  )
}

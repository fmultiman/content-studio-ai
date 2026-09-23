export function calculatePreviewFitScale(availableWidth: number, availableHeight: number, canvasWidth: number, canvasHeight: number): number {
  if (availableWidth <= 0 || availableHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return 0
  return Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1)
}

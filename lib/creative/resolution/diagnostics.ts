import type { z } from 'zod'

export type RuntimeDiagnosticKind =
  | 'schema_error'
  | 'template_error'
  | 'binding_error'
  | 'identity_error'
  | 'asset_error'

export type RuntimeDiagnostic = {
  kind: RuntimeDiagnosticKind
  code: string
  message: string
  path?: string
  issues?: z.ZodIssue[]
}

export type ResolutionResult<T> =
  | { valid: true; errors: RuntimeDiagnostic[]; warnings: RuntimeDiagnostic[]; value: T }
  | { valid: false; errors: RuntimeDiagnostic[]; warnings: RuntimeDiagnostic[]; value?: undefined }

export function schemaDiagnostics(error: z.ZodError): RuntimeDiagnostic[] {
  return error.issues.map((issue) => ({
    kind: 'schema_error',
    code: 'schema_invalid',
    message: issue.message,
    path: issue.path.join('.'),
  }))
}

export function resolutionResult<T>(errors: RuntimeDiagnostic[], value?: T): ResolutionResult<T> {
  if (errors.length > 0 || value === undefined) return { valid: false, errors, warnings: [] }
  return { valid: true, errors: [], warnings: [], value }
}

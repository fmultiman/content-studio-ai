'use client'

/**
 * Content tab for the structured layouts — renders a layout's field
 * descriptors (lib/creative/authoring/layout-content-fields.ts) with the
 * Editor's existing controls. Every change goes through the bounded content
 * actions (SET_CONTENT_VALUE / ADD_CONTENT_ITEM / REMOVE_CONTENT_ITEM).
 */
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getContentAt, type AuthoringAction, type ContentPath } from '@/lib/creative/authoring'
import { ICON_LABELS, UF_OPTIONS, type ContentFieldDescriptor, type ItemFieldDescriptor } from '@/lib/creative/authoring/layout-content-fields'

type Dispatch = (action: AuthoringAction) => void

const fieldId = (path: ContentPath) => `content-${path.join('-')}`

function TextField({ path, label, rows = 2, optional, hint, maxLength, value, dispatch }: { path: ContentPath; label: string; rows?: number; optional?: boolean; hint?: string; maxLength?: number; value: unknown; dispatch: Dispatch }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={fieldId(path)}>{label}{optional ? <span className="ml-1 text-[11px] font-normal text-muted-foreground">(opcional)</span> : null}</Label>
      <Textarea id={fieldId(path)} value={typeof value === 'string' ? value : ''} rows={rows} maxLength={maxLength} onChange={(event) => dispatch({ type: 'SET_CONTENT_VALUE', path, value: event.target.value, optional })} />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ItemField({ field, path, value, dispatch }: { field: ItemFieldDescriptor; path: ContentPath; value: unknown; dispatch: Dispatch }) {
  if (field.kind === 'icon' || field.kind === 'uf') {
    const options = field.kind === 'icon' ? Object.entries(ICON_LABELS) : UF_OPTIONS.map((uf) => [uf, uf] as const)
    return (
      <Select value={typeof value === 'string' ? value : undefined} onValueChange={(next) => dispatch({ type: 'SET_CONTENT_VALUE', path, value: next })}>
        <SelectTrigger className="h-7 w-full text-xs" aria-label={field.label}><SelectValue placeholder={field.label} /></SelectTrigger>
        <SelectContent>{options.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
      </Select>
    )
  }
  return <Textarea aria-label={field.label} placeholder={field.optional ? `${field.label} (opcional)` : field.label} value={typeof value === 'string' ? value : ''} rows={field.rows ?? 1} onChange={(event) => dispatch({ type: 'SET_CONTENT_VALUE', path, value: event.target.value, optional: field.optional })} />
}

function ListHeader({ label, count, max }: { label: string; count: number; max: number }) {
  return <legend className="text-sm font-medium">{label} ({count}/{max})</legend>
}

function Field({ field, base, content, dispatch }: { field: ContentFieldDescriptor; base: ContentPath; content: unknown; dispatch: Dispatch }) {
  const path = [...base, field.key]
  const value = getContentAt(content, path)
  if (field.kind === 'text') return <TextField path={path} label={field.label} rows={field.rows} optional={field.optional} hint={field.hint} maxLength={field.maxLength} value={value} dispatch={dispatch} />

  if (field.kind === 'group') {
    const present = value !== undefined && value !== null
    return (
      <fieldset className="space-y-2 rounded-md border border-border/60 p-2" data-testid={`content-group-${field.key}`}>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={present} onChange={(event) => dispatch({ type: 'SET_CONTENT_VALUE', path, value: event.target.checked ? field.newValue : undefined, optional: true })} />
          {field.label}
        </label>
        {present ? field.fields.map((sub) => <Field key={sub.key} field={sub} base={path} content={content} dispatch={dispatch} />) : null}
      </fieldset>
    )
  }

  const list = Array.isArray(value) ? value : []
  const add = () => {
    if (!Array.isArray(value)) dispatch({ type: 'SET_CONTENT_VALUE', path, value: [] })
    dispatch({ type: 'ADD_CONTENT_ITEM', path, item: field.newItem, max: field.max })
  }
  const remove = (index: number) => {
    if (field.optional && list.length === 1) dispatch({ type: 'SET_CONTENT_VALUE', path, value: undefined, optional: true })
    else dispatch({ type: 'REMOVE_CONTENT_ITEM', path, index, min: field.min })
  }
  const canRemove = field.optional ? list.length > field.min || list.length === 1 : list.length > field.min
  return (
    <fieldset className="space-y-2" data-testid={`content-list-${field.key}`}>
      <ListHeader label={field.label} count={list.length} max={field.max} />
      {list.map((item, index) => (
        <div key={index} className="space-y-1.5 rounded-md border border-border/60 p-2" data-testid="content-list-item">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{field.itemLabel} {index + 1}</span>
            <Button size="icon-sm" variant="ghost" disabled={!canRemove} onClick={() => remove(index)} aria-label={`Remover ${field.itemLabel.toLowerCase()} ${index + 1}`} title="Remover"><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
          {field.kind === 'strings'
            ? <Textarea aria-label={`${field.itemLabel} ${index + 1}`} value={typeof item === 'string' ? item : ''} rows={2} onChange={(event) => dispatch({ type: 'SET_CONTENT_VALUE', path: [...path, index], value: event.target.value })} />
            : field.fields.map((sub) => <ItemField key={sub.key} field={sub} path={[...path, index, sub.key]} value={(item as Record<string, unknown>)?.[sub.key]} dispatch={dispatch} />)}
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-full gap-1 text-xs" disabled={list.length >= field.max} onClick={add}><Plus className="h-3 w-3" />Adicionar {field.itemLabel.toLowerCase()}</Button>
    </fieldset>
  )
}

export function LayoutContentForm({ fields, content, dispatch }: { fields: readonly ContentFieldDescriptor[]; content: unknown; dispatch: Dispatch }) {
  return (
    <div className="space-y-3" data-testid="layout-content-form">
      {fields.map((field) => <Field key={field.key} field={field} base={[]} content={content} dispatch={dispatch} />)}
    </div>
  )
}

'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  suggestions?: string[]
  className?: string
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Digite e pressione Enter...',
  suggestions = [],
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Converter string em array de tags (separado por vírgula)
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)

  // Converter array de tags em string
  const tagsToString = (tagArray: string[]) => tagArray.join(', ')

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim().toLowerCase()
    if (trimmedTag && !tags.includes(trimmedTag)) {
      const newTags = [...tags, trimmedTag]
      onChange(tagsToString(newTags))
    }
    setInputValue('')
  }

  const removeTag = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove)
    onChange(tagsToString(newTags))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (inputValue.trim()) {
        addTag(inputValue)
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  const handleInputBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue)
    }
  }

  // Filtrar sugestões que ainda não foram adicionadas
  const availableSuggestions = suggestions.filter(
    (suggestion) => !tags.includes(suggestion.toLowerCase())
  )

  return (
    <div className={cn('space-y-3', className)}>
      {/* Tags Display + Input */}
      <div
        className="flex min-h-[80px] flex-wrap items-start gap-2 rounded-md border border-input bg-background/50 p-3 focus-within:ring-1 focus-within:ring-ring"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="gap-1 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className="ml-1 rounded-full hover:bg-violet-500/50"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="h-auto min-w-[120px] flex-1 border-0 bg-transparent p-0 text-sm placeholder:text-muted-foreground focus-visible:ring-0"
        />
      </div>

      {/* Suggestions */}
      {availableSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className="rounded-full border border-border/50 bg-background/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-300"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

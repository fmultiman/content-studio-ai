'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { GripVertical, Trash2, ImageIcon, Sparkles, Loader2, Upload, X } from 'lucide-react'
import type { VideoScene } from '@/lib/types'

interface SceneCardProps {
  scene: VideoScene
  sceneNumber: number
  onUpdate: (scene: VideoScene) => void
  onDelete: () => void
  onGeneratePrompt: (scene: VideoScene, sceneNumber: number) => Promise<string>
}

const movementOptions = [
  { value: 'static', label: 'Estático' },
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'zoom_out', label: 'Zoom Out' },
  { value: 'pan_left', label: 'Pan Esquerda' },
  { value: 'pan_right', label: 'Pan Direita' },
  { value: 'tilt_up', label: 'Tilt Cima' },
  { value: 'tilt_down', label: 'Tilt Baixo' },
  { value: 'dolly', label: 'Dolly Forward' },
]

const durationOptions = [
  { value: 2, label: '2 segundos' },
  { value: 3, label: '3 segundos' },
  { value: 4, label: '4 segundos' },
  { value: 5, label: '5 segundos' },
  { value: 8, label: '8 segundos' },
  { value: 10, label: '10 segundos' },
]

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function SceneCard({ scene, sceneNumber, onUpdate, onDelete, onGeneratePrompt }: SceneCardProps) {
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleGeneratePrompt = async () => {
    if (!scene.description) return

    setIsGeneratingPrompt(true)
    setPromptError(null)
    try {
      const prompt = await onGeneratePrompt(scene, sceneNumber)
      onUpdate({ ...scene, prompt })
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : 'Erro ao gerar prompt')
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  const handleFileChange = useCallback((file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      alert('Por favor, selecione uma imagem JPG, PNG ou WEBP.')
      return
    }

    // Convert to base64 for local preview
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      onUpdate({ ...scene, image_url: base64 })
    }
    reader.readAsDataURL(file)
  }, [scene, onUpdate])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileChange(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileChange(file)
    }
  }

  const handleRemoveImage = () => {
    onUpdate({ ...scene, image_url: null })
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <div className="cursor-grab text-muted-foreground">
            <GripVertical className="h-5 w-5" />
          </div>
          <span className="font-semibold text-foreground">Cena {sceneNumber}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Image/Prompt Row */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Image Input */}
          <div className="space-y-2">
            <Label>Imagem Base (opcional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleInputChange}
              className="hidden"
            />
            {scene.image_url ? (
              <div className="relative h-24 overflow-hidden rounded-lg border border-border/50">
                <img
                  src={scene.image_url}
                  alt={`Cena ${sceneNumber}`}
                  className="h-full w-full object-cover"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={handleRemoveImage}
                  className="absolute right-1 top-1 h-6 w-6"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex h-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                  isDragging
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-border/50 bg-background/50 hover:border-violet-500/50 hover:bg-background/80'
                }`}
              >
                <div className="text-center text-sm text-muted-foreground">
                  <Upload className="mx-auto mb-1 h-6 w-6" />
                  <span>Clique ou arraste</span>
                  <p className="text-xs">JPG, PNG, WEBP</p>
                </div>
              </div>
            )}
          </div>

          {/* Duration & Movement */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Duração</Label>
                <Select
                  value={String(scene.duration)}
                  onValueChange={(value) =>
                    onUpdate({ ...scene, duration: Number(value) })
                  }
                >
                  <SelectTrigger className="h-9 bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {durationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Movimento</Label>
                <Select
                  value={scene.movement || 'static'}
                  onValueChange={(value) =>
                    onUpdate({ ...scene, movement: value })
                  }
                >
                  <SelectTrigger className="h-9 bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {movementOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Scene Description */}
        <div className="space-y-2">
          <Label>Descrição da Cena</Label>
          <Textarea
            placeholder="Descreva o que deve acontecer nesta cena..."
            value={scene.description}
            onChange={(e) => onUpdate({ ...scene, description: e.target.value })}
            rows={2}
            className="resize-none bg-background/50"
          />
        </div>

        {/* Generated Prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Prompt Gerado</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGeneratePrompt}
              disabled={!scene.description || isGeneratingPrompt}
              className="h-7 text-xs"
            >
              {isGeneratingPrompt ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              Gerar
            </Button>
          </div>
          <Textarea
            placeholder="O prompt será gerado automaticamente..."
            value={scene.prompt || ''}
            onChange={(e) => onUpdate({ ...scene, prompt: e.target.value })}
            rows={2}
            className="resize-none bg-background/50 font-mono text-xs"
          />
          {promptError && (
            <p className="text-xs text-destructive">{promptError}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

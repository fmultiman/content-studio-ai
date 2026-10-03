import { describe, expect, it } from 'vitest'
import {
  VideoGenerationWorkingStateV1Schema,
  attemptToWorkingState,
  type HistoricalVideoGenerationSnapshot,
} from '../video-generation/working-state'
import { REST_CONNECTION_REF, accountConnectionRef } from '../video-generation/connection-ref'

describe('Video Generation Working State Core', () => {
  describe('Schema Validation', () => {
    it('validates a correct V1 working state', () => {
      const state = {
        schemaVersion: 1,
        prompt: 'a futuristic city',
        source: null,
        selection: {
          connectionRef: REST_CONNECTION_REF,
          operation: 'text_to_video',
          modelId: 'kling-v1.6-standard',
          duration: 5,
          resolution: '1080p',
          aspectRatio: '16:9',
          audio: 'off',
          multiShot: false,
          asmr: false,
          audioPrompt: '',
          musicPrompt: '',
        },
      }
      expect(VideoGenerationWorkingStateV1Schema.parse(state)).toEqual(state)
    })

    it('rejects unsupported schema versions', () => {
      const state = {
        schemaVersion: 2,
        prompt: 'test',
        source: null,
        selection: {
          connectionRef: REST_CONNECTION_REF,
          operation: 'text_to_video',
          modelId: 'model',
          duration: 5,
          resolution: '1080p',
          aspectRatio: '16:9',
          audio: 'off',
          multiShot: false,
          asmr: false,
          audioPrompt: '',
          musicPrompt: '',
        },
      }
      expect(() => VideoGenerationWorkingStateV1Schema.parse(state)).toThrow()
    })

    it('rejects malformed top-level missing prompt', () => {
      const state = {
        schemaVersion: 1,
        // missing prompt
        source: null,
        selection: {
          connectionRef: REST_CONNECTION_REF,
          operation: 'text_to_video',
          modelId: 'model',
          duration: 5,
          resolution: '1080p',
          aspectRatio: '16:9',
          audio: 'off',
          multiShot: false,
          asmr: false,
          audioPrompt: '',
          musicPrompt: '',
        },
      }
      expect(() => VideoGenerationWorkingStateV1Schema.parse(state)).toThrow()
    })

    it('rejects malformed selection operation', () => {
      const state = {
        schemaVersion: 1,
        prompt: 'test',
        source: null,
        selection: {
          connectionRef: REST_CONNECTION_REF,
          operation: 'invalid_mode',
          modelId: 'model',
          duration: 5,
          resolution: '1080p',
          aspectRatio: '16:9',
          audio: 'off',
          multiShot: false,
          asmr: false,
          audioPrompt: '',
          musicPrompt: '',
        },
      }
      expect(() => VideoGenerationWorkingStateV1Schema.parse(state)).toThrow()
    })

    it('rejects malformed sources', () => {
      const state = {
        schemaVersion: 1,
        prompt: 'test',
        source: { type: 'unknown_type', id: '123' },
        selection: {
           connectionRef: REST_CONNECTION_REF,
           operation: 'image_to_video',
           modelId: 'm',
           duration: null,
           resolution: null,
           aspectRatio: null,
           audio: null,
           multiShot: null,
           asmr: null,
           audioPrompt: null,
           musicPrompt: null,
        },
      }
      expect(() => VideoGenerationWorkingStateV1Schema.parse(state)).toThrow()
    })
  })

  describe('attemptToWorkingState', () => {
    it('A. parses T2V REST correctly', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'A calm mountain',
        mode: 'text_to_video',
        model: 'model-a',
        transport: 'rest',
        request_config: { duration: 5, aspect_ratio: '16:9' },
      }
      const state = attemptToWorkingState(attempt)
      expect(state.prompt).toBe('A calm mountain')
      expect(state.source).toBeNull()
      expect(state.selection.connectionRef).toBe(REST_CONNECTION_REF)
      expect(state.selection.operation).toBe('text_to_video')
      expect(state.selection.modelId).toBe('model-a')
      expect(state.selection.duration).toBe(5)
      expect(state.selection.aspectRatio).toBe('16:9')
    })

    it('B. handles Legacy REST (transport = null)', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'A fast car',
        mode: 'text_to_video',
        model: 'model-old',
        transport: null, // Legacy row
        request_config: { duration: 5 },
      }
      const state = attemptToWorkingState(attempt)
      expect(state.selection.connectionRef).toBe(REST_CONNECTION_REF)
    })

    it('C. maps T2V MCP correctly', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'MCP generated video',
        mode: 'text_to_video',
        model: 'model-mcp',
        transport: 'mcp',
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        request_config: { multi_shot: true, asmr: false },
      }
      const state = attemptToWorkingState(attempt)
      expect(state.selection.connectionRef).toBe(accountConnectionRef('123e4567-e89b-12d3-a456-426614174000'))
      expect(state.selection.multiShot).toBe(true)
      expect(state.selection.asmr).toBe(false)
    })

    it('D. maps I2V with generated source', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'I2V generated image',
        mode: 'image_to_video',
        model: 'm1',
        source_image_id: 'img1',
        request_config: {},
      }
      const state = attemptToWorkingState(attempt)
      expect(state.source).toEqual({ type: 'generated', id: 'img1' })
    })

    it('E. maps I2V with library source', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'I2V library image',
        mode: 'image_to_video',
        model: 'm1',
        source_library_file_id: 'lib1',
        request_config: {},
      }
      const state = attemptToWorkingState(attempt)
      expect(state.source).toEqual({ type: 'library', id: 'lib1' })
    })

    it('F. missing MCP connection pointer gracefully degrades', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'MCP without connection ID',
        mode: 'text_to_video',
        model: 'm1',
        transport: 'mcp', // But no connection_id!
        request_config: {},
      }
      const state = attemptToWorkingState(attempt)
      expect(state.selection.connectionRef).toBeNull() // Not inventing a REST or generic connection
    })

    it('G. missing source for I2V gracefully degrades', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'I2V without source',
        mode: 'image_to_video',
        model: 'm1',
        request_config: {},
      }
      const state = attemptToWorkingState(attempt)
      expect(state.source).toBeNull()
    })

    it('H. preserves advanced controls accurately', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'Advanced fields test',
        mode: 'text_to_video',
        model: 'm1',
        request_config: {
          audio: 'on',
          multi_shot: true,
          asmr: true,
          audio_prompt: 'some audio prompt',
          music_prompt: 'some music prompt',
        },
      }
      const state = attemptToWorkingState(attempt)
      expect(state.selection.audio).toBe('on')
      expect(state.selection.multiShot).toBe(true)
      expect(state.selection.asmr).toBe(true)
      expect(state.selection.audioPrompt).toBe('some audio prompt')
      expect(state.selection.musicPrompt).toBe('some music prompt')
    })

    it('I. gracefully handles absent historical request config fields', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'Minimal payload',
        mode: 'text_to_video',
        model: 'm1',
        request_config: null,
      }
      const state = attemptToWorkingState(attempt)
      expect(state.selection.duration).toBeNull()
      expect(state.selection.audio).toBeNull()
    })

    it('ignores extraneous config fields rather than throwing', () => {
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'Extra fields',
        mode: 'text_to_video',
        model: 'm1',
        request_config: { foo: 'bar', another_field: 123 },
      }
      const state = attemptToWorkingState(attempt)
      // They are absent from the typed selection
      expect((state.selection as any).foo).toBeUndefined()
    })

    it('I2V -> T2V mode clears source by relying on the reconciliation/working-state', () => {
      // If historical data somehow has an image_id but mode is T2V, source should be null.
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'T2V with accidentally attached source',
        mode: 'text_to_video',
        model: 'm1',
        source_image_id: 'img1',
      }
      const state = attemptToWorkingState(attempt)
      expect(state.source).toBeNull()
    })

    it('K. does not mutate the original attempt object', () => {
      const config = { duration: 5 }
      const attempt: HistoricalVideoGenerationSnapshot = {
        prompt: 'Pure test',
        mode: 'text_to_video',
        model: 'm1',
        request_config: config,
      }
      const attemptCopy = { ...attempt, request_config: { ...config } }
      attemptToWorkingState(attempt)
      expect(attempt).toEqual(attemptCopy)
    })
  })
})

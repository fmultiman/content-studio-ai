import { describe, expect, it } from 'vitest'
import { buildPromptAssistanceContext } from '../context'

describe('Prompt Assistance context compiler', () => {
  it('keeps Identity semantics and adds validated visual tokens without raw JSON', () => {
    const result = buildPromptAssistanceContext({
      projectContext: 'A campanha é documental.',
      production: { title: 'Rios', intention: 'Aproximar pessoas da água.', type: 'editorial' },
      identity: {
        schema_version: 1,
        foundation: { purpose: 'Educar.' },
        governance: { principles: ['clareza'], restrictions: ['sem neon'] },
        visuals: { colors: { background: '#ffffff', accent: '#ff0066' }, typography: { display_font: 'Inter' } },
      },
    })
    expect(result).toContain('Propósito')
    expect(result).toContain('Restrições')
    expect(result).toContain('#ff0066')
    expect(result).toContain('display_font: Inter')
    expect(result).not.toContain('schema_version')
  })
})

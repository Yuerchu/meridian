import { renderHook } from '@testing-library/react'

import type { AcpConfigOptionInfoResponse } from '@/types'
import { useComposerTypeahead } from './use-composer-typeahead'

describe('useComposerTypeahead', () => {
  it('uses the ACP thought_level category when the hosted effort option has an adapter-specific id', () => {
    const option: AcpConfigOptionInfoResponse = {
      id: 'claude.reasoning',
      name: 'Reasoning',
      category: 'thought_level',
      type: 'select',
      currentValue: 'medium',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    }

    const { result } = renderHook(() =>
      useComposerTypeahead({
        value: '/thinking ',
        caret: '/thinking '.length,
        conversationId: 'conversation-1',
        projectId: null,
        isHosted: true,
        supportsFast: true,
        providerId: null,
        capabilities: null,
        acpOptions: [option],
        platform: 'windows',
      }),
    )

    expect(result.current.items).toEqual([
      expect.objectContaining({ label: 'Low', insertText: '/thinking low' }),
      expect.objectContaining({ label: 'High', insertText: '/thinking high' }),
    ])
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'

vi.mock('@/lib/transport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/transport')>('@/lib/transport')
  return {
    ...actual,
    listen: vi.fn(async () => () => {}),
  }
})
vi.mock('@/lib/asset-src', () => ({
  assetSrc: (uri: string) => uri,
}))

import { api } from '@/api'
import { StudioPage } from './index'
import type { LogicalModelInfoResponse, MediaGenerationInfoResponse } from '@/types'

const IMAGE_MODEL: LogicalModelInfoResponse = {
  profile: {
    id: 'img-model-1',
    name: 'GPT Image 1',
    canonical_id: 'openai/gpt-image-1',
    capability_domain: 'image_gen',
    family: 'openai-image',
    icon: null,
    routing_policy: 'auto_failover_stateless',
    is_archived: false,
    context_window: 128000,
    compact_threshold: 100000,
    max_output_tokens: null,
    pricing: null,
    capability_overrides: null,
    model_count: 2,
  },
  deployments: [
    {
      id: 'dep-img-1',
      provider_id: 'prov-1',
      provider_name: 'OpenAI Primary',
      model_id: 'gpt-image-1',
      profile_id: 'img-model-1',
      protocol_override: 'openai_images',
      effective_protocol: 'openai_images',
      is_enabled: true,
      priority: 0,
      compliance: { status: 'standard' },
      capability_overrides: null,
    },
    {
      id: 'dep-img-2',
      provider_id: 'prov-2',
      provider_name: 'OpenAI Backup',
      model_id: 'gpt-image-1',
      profile_id: 'img-model-1',
      protocol_override: 'openai_images',
      effective_protocol: 'openai_images',
      is_enabled: true,
      priority: 1,
      compliance: { status: 'standard' },
      capability_overrides: null,
    },
  ],
}

const VIDEO_MODEL: LogicalModelInfoResponse = {
  profile: {
    id: 'vid-model-1',
    name: 'Google Veo 3.1',
    canonical_id: 'google/veo-3.1',
    capability_domain: 'video_gen',
    family: 'google-veo',
    icon: null,
    routing_policy: 'auto_failover_stateless',
    is_archived: false,
    context_window: 128000,
    compact_threshold: 100000,
    max_output_tokens: null,
    pricing: null,
    capability_overrides: null,
    model_count: 1,
  },
  deployments: [
    {
      id: 'dep-vid-1',
      provider_id: 'prov-g',
      provider_name: 'Google Gemini',
      model_id: 'veo-3.1-generate-preview',
      profile_id: 'vid-model-1',
      protocol_override: 'google_veo',
      effective_protocol: 'google_veo',
      is_enabled: true,
      priority: 0,
      compliance: { status: 'standard' },
      capability_overrides: null,
    },
  ],
}

const CHAT_MODEL: LogicalModelInfoResponse = {
  profile: {
    id: 'chat-model-1',
    name: 'Claude Sonnet 4.6',
    canonical_id: 'anthropic/claude-sonnet-4-6',
    capability_domain: 'chat',
    family: 'anthropic-claude',
    icon: null,
    routing_policy: 'sticky_manual',
    is_archived: false,
    context_window: 200000,
    compact_threshold: 150000,
    max_output_tokens: null,
    pricing: null,
    capability_overrides: null,
    model_count: 1,
  },
  deployments: [
    {
      id: 'dep-chat-1',
      provider_id: 'prov-a',
      provider_name: 'Anthropic',
      model_id: 'claude-sonnet-4-6',
      profile_id: 'chat-model-1',
      protocol_override: null,
      effective_protocol: 'anthropic_messages',
      is_enabled: true,
      priority: 0,
      compliance: { status: 'standard' },
      capability_overrides: null,
    },
  ],
}

const SAMPLE_IMAGE_GEN: MediaGenerationInfoResponse = {
  id: 'gen-img-1',
  capability_domain: 'image_gen',
  logical_model_id: 'img-model-1',
  deployment_id: 'dep-img-1',
  provider_id: 'prov-1',
  remote_model_id: 'gpt-image-1',
  protocol_id: 'openai_images',
  prompt: 'minimalist alpine cabin',
  params_json: '{}',
  status: 'succeeded',
  progress_pct: 100,
  upstream_job_id: null,
  assets: [
    {
      file_uri: 'file:///demo/media_generations/gen-img-1/00.png',
      relative_path: 'gen-img-1/00.png',
      mime_type: 'image/png',
      bytes_len: 1024,
      width: 1024,
      height: 1024,
      duration_seconds: null,
      revised_prompt: null,
      produce_id: 'produce-1',
      is_ai_generated: true,
      watermark_snapshot: null,
    },
  ],
  error_message: null,
  conversation_id: null,
  source: 'studio',
  created_at: 1000,
  updated_at: 1000,
  completed_at: 1000,
}

describe('StudioPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api.logicalModels, 'list').mockResolvedValue([CHAT_MODEL, IMAGE_MODEL, VIDEO_MODEL])
    vi.spyOn(api.media, 'list').mockResolvedValue([SAMPLE_IMAGE_GEN])
    vi.spyOn(api.preferences, 'get').mockResolvedValue({
      key: 'media.default_image_model_id',
      value: null,
    })
  })

  it('filters models strictly by domain, displays stateless failover badge, and reuses clean gallery originals', async () => {
    const createSpy = vi.spyOn(api.media, 'create').mockResolvedValue({
      ...SAMPLE_IMAGE_GEN,
      id: 'gen-img-2',
      prompt: 'snowy twilight version',
    })
    const user = userEvent.setup()

    render(<StudioPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /GPT Image 1/i })).toBeInTheDocument()
    })

    // Open model dropdown and confirm strict domain isolation (no chat or video models)
    await user.click(screen.getByRole('button', { name: /GPT Image 1/i }))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toHaveLength(1)
    expect(options[0]).toContain('GPT Image 1')
    expect(options[0]).not.toContain('Claude Sonnet 4.6')
    expect(options[0]).not.toContain('Google Veo 3.1')
    await user.keyboard('{Escape}')

    // Multi-deployment stateless failover badge is visible
    expect(document.querySelector('[data-slot="studio-failover-badge"]')).toBeInTheDocument()

    // Reuse clean original from gallery as reference image
    await user.click(screen.getByRole('button', { name: /use as reference|用作参考图/i }))
    expect(document.querySelector('[data-slot="studio-reference-chip"]')).toBeInTheDocument()

    // Submit generation with reused original reference
    await user.type(screen.getByRole('textbox', { name: /prompt|提示词/i }), 'snowy twilight version')
    await user.click(document.querySelector('[data-slot="studio-generate-btn"]') as HTMLElement)

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1)
    })
    const req = createSpy.mock.calls[0][0]
    expect(req.capability_domain).toBe('image_gen')
    expect(req.logical_model_id).toBe('img-model-1')
    expect(req.reference_images).toHaveLength(1)
    expect(req.reference_images[0].existing_generation_id).toBe('gen-img-1')
    expect(req.reference_images[0].existing_asset_index).toBe(0)
    expect(req.reference_images[0].base64_data).toBeNull()
  })
})

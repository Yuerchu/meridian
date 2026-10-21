import type { LocalInferenceBackend, LocalModelInfoResponse } from '@/types'

// 仅供 DEV 演示，不读取文件或探测硬件，也不作为真实模型的默认配置。
export function demoLocalModel(modelPath: string, backend: LocalInferenceBackend): LocalModelInfoResponse {
  const segments = modelPath.split(/[\\/]/)
  const name = segments[segments.length - 1]
  if (typeof name !== 'string' || name === '' || modelPath === 'local://') throw 'demo: select a model file first'
  if (backend === 'npu') throw 'demo: this fixture only declares GPU and CPU support'
  return {
    runtime_version: '0.18.0',
    file_name: name,
    file_size_bytes: 7300000000,
    revision: 'demo-model-revision',
    requested_backend: backend,
    resolved_backend: backend === 'auto' ? 'gpu' : backend,
    kind: 'llm',
    modalities: [
      { modality: 'text', preferred_backends: ['gpu', 'cpu'], npu_brand: null, soc_name: null },
      { modality: 'vision', preferred_backends: ['cpu'], npu_brand: null, soc_name: null },
    ],
    supports_thinking: true,
    supports_function_calling: false,
    supports_speculative_decoding: true,
    sampler_defaults: { sampler_type: 'top_p', temperature: 1, top_k: 64, top_p: 0.95 },
    max_context_tokens: 128021,
    is_dynamic_context: true,
    max_vision_token_budget: 1120,
    vision_signature_lengths: [256, 1024],
    embedding_signature_lengths: null,
    embedding_dimension: null,
    min_runtime_version: '0.17.0',
  }
}

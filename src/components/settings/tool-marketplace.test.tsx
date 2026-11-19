import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/api'
import i18n from '@/i18n'
import type { CustomToolInfoResponse } from '@/types'
import { CustomToolEditor } from './tool-marketplace'

vi.mock('@/api', () => ({ api: { updateCustomTool: vi.fn(), createCustomTool: vi.fn() } }))

const legacy: CustomToolInfoResponse = {
  id: 'legacy',
  name: 'legacy',
  description: 'Legacy tool',
  category_id: null,
  parameters_schema: { type: 'object', properties: { input: { type: 'string' } } },
  command: "  printf '%s'\n# preserved  ",
  args_template: '"{{input}}"\n ',
  execution: null,
  working_directory: '/workspace',
  timeout_ms: null,
  permission: 'ask',
  is_enabled: false,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.updateCustomTool).mockResolvedValue(legacy)
})

it('preserves disabled multiline legacy source, cwd, schema, and nullable timeout on save', async () => {
  const user = userEvent.setup()
  render(<CustomToolEditor tool={legacy} onSaved={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByLabelText(/Preserved legacy command/).tagName).toBe('TEXTAREA')
  expect(screen.getByLabelText(/Preserved legacy arguments/)).toHaveValue(legacy.args_template)
  await user.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() =>
    expect(api.updateCustomTool).toHaveBeenCalledWith(
      expect.objectContaining({
        command: legacy.command,
        argsTemplate: legacy.args_template,
        execution: null,
        isEnabled: false,
        workingDirectory: legacy.working_directory,
        parametersSchema: legacy.parameters_schema,
        timeoutMs: null,
      }),
    ),
  )
})

it('explicitly converts a legacy tool and enables its typed definition', async () => {
  const user = userEvent.setup()
  render(<CustomToolEditor tool={legacy} onSaved={vi.fn()} onCancel={vi.fn()} />)
  const execution = { kind: 'script', script: 'printf "%s" "$1"', args: [{ kind: 'parameter', name: 'input' }] }
  fireEvent.change(screen.getByLabelText(/Execution definition/), { target: { value: JSON.stringify(execution) } })
  await user.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() =>
    expect(api.updateCustomTool).toHaveBeenCalledWith(expect.objectContaining({ execution, isEnabled: true })),
  )
})

it('does not enable an already-safe disabled tool when editing it', async () => {
  const user = userEvent.setup()
  render(
    <CustomToolEditor
      tool={{ ...legacy, execution: { kind: 'executable', program: 'echo', args: [] } }}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() => expect(api.updateCustomTool).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false })))
})

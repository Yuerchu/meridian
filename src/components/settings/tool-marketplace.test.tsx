import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/api'
import i18n from '@/i18n'
import type { CustomToolInfoResponse } from '@/types'
import { CustomToolEditor } from './tool-marketplace'

vi.mock('@/api', () => ({ api: { tools: { updateCustom: vi.fn(), createCustom: vi.fn() } } }))

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
  vi.mocked(api.tools.updateCustom).mockResolvedValue(legacy)
})

it('preserves disabled multiline legacy source, cwd, schema, and nullable timeout on save', async () => {
  const user = userEvent.setup()
  render(<CustomToolEditor tool={legacy} onSave={vi.fn()} />)
  expect(screen.getByLabelText(/Preserved legacy command/).tagName).toBe('TEXTAREA')
  expect(screen.getByLabelText(/Preserved legacy arguments/)).toHaveValue(legacy.args_template)
  await user.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() =>
    expect(api.tools.updateCustom).toHaveBeenCalledWith(
      expect.objectContaining({
        command: legacy.command,
        args_template: legacy.args_template,
        execution: null,
        is_enabled: false,
        working_directory: legacy.working_directory,
        parameters_schema: legacy.parameters_schema,
        timeout_ms: null,
      }),
    ),
  )
})

it('explicitly converts a legacy tool and enables its typed definition', async () => {
  const user = userEvent.setup()
  render(<CustomToolEditor tool={legacy} onSave={vi.fn()} />)
  const execution = { kind: 'script', script: 'printf "%s" "$1"', args: [{ kind: 'parameter', name: 'input' }] }
  fireEvent.change(screen.getByLabelText(/Execution definition/), { target: { value: JSON.stringify(execution) } })
  await user.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() =>
    expect(api.tools.updateCustom).toHaveBeenCalledWith(expect.objectContaining({ execution, is_enabled: true })),
  )
})

it('does not enable an already-safe disabled tool when editing it', async () => {
  const user = userEvent.setup()
  render(
    <CustomToolEditor
      tool={{ ...legacy, execution: { kind: 'executable', program: 'echo', args: [] } }}
      onSave={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() =>
    expect(api.tools.updateCustom).toHaveBeenCalledWith(expect.objectContaining({ is_enabled: false })),
  )
})

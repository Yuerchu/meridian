import type { CustomToolArgument, CustomToolExecution } from '@/types'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an execution object')
  }
  return Object.fromEntries(Object.entries(value))
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown execution field')
}

function text(value: unknown, nonempty: boolean): string {
  if (typeof value !== 'string' || value.includes('\0') || (nonempty && !value.trim())) {
    throw new Error('Expected a valid execution string without NUL')
  }
  return value
}

export function parseCustomToolExecution(value: unknown): CustomToolExecution {
  const execution = record(value)
  if (!Array.isArray(execution.args)) throw new Error('Execution args must be an array')
  const args: CustomToolArgument[] = execution.args.map((input: unknown) => {
    const arg = record(input)
    switch (arg.kind) {
      case 'literal':
        keys(arg, ['kind', 'value'])
        return { kind: 'literal', value: text(arg.value, false) }
      case 'parameter':
        keys(arg, ['kind', 'name'])
        return { kind: 'parameter', name: text(arg.name, true) }
      case 'json':
        keys(arg, ['kind'])
        return { kind: 'json' }
      default:
        throw new Error('Unknown argument kind')
    }
  })
  switch (execution.kind) {
    case 'executable':
      keys(execution, ['kind', 'program', 'args'])
      return { kind: 'executable', program: text(execution.program, true), args }
    case 'script':
      keys(execution, ['kind', 'script', 'args'])
      return { kind: 'script', script: text(execution.script, true), args }
    default:
      throw new Error('Unknown execution kind')
  }
}

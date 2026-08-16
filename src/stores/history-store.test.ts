import { useHistoryStore } from './history-store'

const level = (id: string, dismiss: () => void = () => {}) => ({ id, dismiss })
const depth = () => useHistoryStore.getState().levels.length

beforeEach(() => {
  useHistoryStore.setState({ enabled: true, levels: [] })
})

describe('history store', () => {
  it('counts one history entry per level', () => {
    const { push } = useHistoryStore.getState()
    push(level('a'))
    expect(depth()).toBe(1)
    push(level('b'))
    expect(depth()).toBe(2)
  })

  it('ignores a repeat of the same id', () => {
    const { push } = useHistoryStore.getState()
    push(level('a'))
    // StrictMode mounts an effect twice with the same `useId`; a second entry
    // here would cost a back press that appears to do nothing.
    push(level('a'))
    expect(depth()).toBe(1)
  })

  it('drops a level without dismissing it', () => {
    const dismiss = vi.fn()
    const { push, drop } = useHistoryStore.getState()
    push(level('a', dismiss))
    drop('a')
    expect(depth()).toBe(0)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('dismisses innermost first when settling', () => {
    const order: string[] = []
    const { push, settleTo } = useHistoryStore.getState()
    push(level('outer', () => order.push('outer')))
    push(level('inner', () => order.push('inner')))

    settleTo(0)

    expect(order).toEqual(['inner', 'outer'])
    expect(depth()).toBe(0)
  })

  it('sheds only as many levels as the target asks for', () => {
    const { push, settleTo } = useHistoryStore.getState()
    push(level('a'))
    push(level('b'))
    push(level('c'))

    settleTo(1)

    expect(useHistoryStore.getState().levels.map((l) => l.id)).toEqual(['a'])
  })

  it('is idempotent, because a burst of back presses each settles to its own target', () => {
    const dismiss = vi.fn()
    const { push, settleTo } = useHistoryStore.getState()
    push(level('a', dismiss))
    push(level('b', dismiss))

    settleTo(1)
    settleTo(1)
    settleTo(1)

    expect(depth()).toBe(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('clamps a negative target rather than looping past empty', () => {
    const { push, settleTo } = useHistoryStore.getState()
    push(level('a'))

    settleTo(-5)

    expect(depth()).toBe(0)
  })

  it('leaves the stack alone when the target is above it', () => {
    const { push, settleTo } = useHistoryStore.getState()
    push(level('a'))

    settleTo(9)

    expect(depth()).toBe(1)
  })
})

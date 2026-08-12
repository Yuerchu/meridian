import { ROOT, type NavEntry } from '@/lib/nav'
import { useNavStore } from './nav-store'

const CONVERSATIONS: NavEntry = { name: 'conversations' }
const SETTINGS: NavEntry = { name: 'settings' }
const PROVIDER: NavEntry = { name: 'settingsTab', tab: 'provider' }

function reset() {
  useNavStore.setState({ stack: [ROOT], guards: [], depth: 0 })
}

function guard(id: string, spy: () => void) {
  return { id, dismiss: spy }
}

describe('nav store', () => {
  beforeEach(reset)

  it('starts at the conversation with nothing to go back to', () => {
    const s = useNavStore.getState()
    expect(s.stack).toEqual([ROOT])
    expect(s.depth).toBe(0)
  })

  it('counts depth as routes plus guards', () => {
    const s = useNavStore.getState()
    s.push(SETTINGS)
    expect(useNavStore.getState().depth).toBe(1)

    s.push(PROVIDER)
    expect(useNavStore.getState().depth).toBe(2)

    s.registerGuard(guard('a', vi.fn()))
    expect(useNavStore.getState().depth).toBe(3)
  })

  it('replaces the top entry without changing depth', () => {
    const s = useNavStore.getState()
    s.push(SETTINGS)
    s.replaceTop(PROVIDER)

    expect(useNavStore.getState().stack).toEqual([ROOT, PROVIDER])
    expect(useNavStore.getState().depth).toBe(1)
  })

  it('refuses to replace the root', () => {
    useNavStore.getState().replaceTop(SETTINGS)
    expect(useNavStore.getState().stack).toEqual([ROOT])
  })

  it('registers a guard once per id, so StrictMode does not double-push', () => {
    const s = useNavStore.getState()
    s.registerGuard(guard('same', vi.fn()))
    s.registerGuard(guard('same', vi.fn()))

    expect(useNavStore.getState().guards).toHaveLength(1)
    expect(useNavStore.getState().depth).toBe(1)
  })

  it('drops a guard without dismissing it', () => {
    const dismiss = vi.fn()
    const s = useNavStore.getState()
    s.registerGuard(guard('a', dismiss))
    s.dropGuard('a')

    expect(dismiss).not.toHaveBeenCalled()
    expect(useNavStore.getState().depth).toBe(0)
  })

  it('dismisses guards before routes, innermost first', () => {
    const order: string[] = []
    const s = useNavStore.getState()
    s.push(SETTINGS)
    s.push(PROVIDER)
    s.registerGuard(guard('outer', () => order.push('outer')))
    s.registerGuard(guard('inner', () => order.push('inner')))
    expect(useNavStore.getState().depth).toBe(4)

    useNavStore.getState().settleTo(3)
    expect(order).toEqual(['inner'])
    expect(useNavStore.getState().stack).toHaveLength(3)
  })

  it('sheds several levels from one settle, which is what go(-n) delivers', () => {
    const dismissed: string[] = []
    const s = useNavStore.getState()
    s.push(SETTINGS)
    s.push(PROVIDER)
    s.registerGuard(guard('outer', () => dismissed.push('outer')))
    s.registerGuard(guard('inner', () => dismissed.push('inner')))

    useNavStore.getState().settleTo(0)

    expect(dismissed).toEqual(['inner', 'outer'])
    expect(useNavStore.getState().stack).toEqual([ROOT])
    expect(useNavStore.getState().depth).toBe(0)
  })

  it('is idempotent, so a burst of back presses cannot overshoot', () => {
    const s = useNavStore.getState()
    s.push(SETTINGS)
    s.push(PROVIDER)

    useNavStore.getState().settleTo(1)
    useNavStore.getState().settleTo(1)
    useNavStore.getState().settleTo(1)

    expect(useNavStore.getState().stack).toEqual([ROOT, SETTINGS])
    expect(useNavStore.getState().depth).toBe(1)
  })

  it('never pops past the root', () => {
    const s = useNavStore.getState()
    s.push(SETTINGS)

    useNavStore.getState().settleTo(-5)

    expect(useNavStore.getState().stack).toEqual([ROOT])
    expect(useNavStore.getState().depth).toBe(0)
  })

  it('ignores a settle that asks for more depth than there is', () => {
    const s = useNavStore.getState()
    s.push(SETTINGS)

    useNavStore.getState().settleTo(9)

    expect(useNavStore.getState().stack).toEqual([ROOT, SETTINGS])
    expect(useNavStore.getState().depth).toBe(1)
  })
})

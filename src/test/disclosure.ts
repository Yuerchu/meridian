import { expect } from 'vitest'

/**
 * Assertions for HeroUI disclosures — `Turn`, `ChatTool`, `ChainOfThought`.
 *
 * base-ui's `Collapsible` returned `null` while collapsed, so "is it hidden"
 * and "is it in the DOM" were the same question and `queryByText` answered
 * both. React Aria, which HeroUI's `Disclosure` is built on, always renders the
 * panel and marks it `aria-hidden` + `hidden="until-found"` instead. Testing
 * Library's text queries and `querySelector` look straight through both, so
 * every "X is hidden behind the trigger" assertion written against presence now
 * passes whether the panel is open or shut.
 *
 * `toBeVisible()` is the one check that still tells them apart: it walks the
 * ancestors and honours the `hidden` attribute. These helpers pair it with the
 * trigger's `aria-expanded` so the two can never drift — a panel that reports
 * itself collapsed while rendering in the open fails here.
 */

/** The panel a trigger owns. `aria-controls` is the only link between them that
 *  does not assume the panel sits in the trigger's subtree. */
export function disclosurePanel(trigger: Element): HTMLElement {
  const id = trigger.getAttribute('aria-controls')
  expect(id, 'the trigger names no panel via aria-controls').toBeTruthy()
  const panel = trigger.ownerDocument.getElementById(id!)
  expect(panel, `no panel with id ${id}`).not.toBeNull()
  return panel!
}

/** The trigger says shut and its panel is genuinely out of sight. */
export function expectCollapsed(trigger: Element): void {
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(disclosurePanel(trigger)).not.toBeVisible()
}

/** The trigger says open and its panel is genuinely on screen. */
export function expectExpanded(trigger: Element): void {
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(disclosurePanel(trigger)).toBeVisible()
}

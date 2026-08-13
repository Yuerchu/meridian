import { readFileSync } from 'node:fs'

/**
 * Guards the two things about these files that fail quietly.
 *
 * A duplicate key is valid JSON: the parser keeps the last one and the earlier
 * text simply stops being used, with nothing to notice at build time. That is
 * how a rewritten delete-confirmation reverted to its old wording during a
 * merge — both branches had touched the same neighbourhood.
 *
 * Reading the raw text rather than importing the modules is the whole point;
 * by the time it is an object the duplicate is gone.
 */
const LOCALES = ['en', 'zh-CN'] as const

function raw(locale: string): string {
  // Relative to the project root, which is where vitest runs from.
  return readFileSync(`src/i18n/locales/${locale}.json`, 'utf8')
}

function keysOf(text: string): string[] {
  return [...text.matchAll(/^\s*"((?:[^"\\]|\\.)+)"\s*:/gm)].map((m) => m[1])
}

/**
 * i18next appends a plural category, and which categories exist is a property
 * of the language — English distinguishes one from other, Chinese has only the
 * one form. Comparing those literally would report every plural as a missing
 * translation, so coverage is measured on the base key.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

function baseKeysOf(text: string): string[] {
  return keysOf(text).map((k) => k.replace(PLURAL_SUFFIX, ''))
}

describe('locale files', () => {
  it.each(LOCALES)('%s has no duplicate keys', (locale) => {
    const keys = keysOf(raw(locale))
    const seen = new Set<string>()
    const duplicates = keys.filter((k) => !seen.add(k))
    expect(duplicates).toEqual([])
  })

  it('defines the same keys in every locale', () => {
    const [first, ...rest] = LOCALES
    const base = new Set(baseKeysOf(raw(first)))
    for (const locale of rest) {
      const other = new Set(baseKeysOf(raw(locale)))
      expect({
        locale,
        missing: [...base].filter((k) => !other.has(k)),
        extra: [...other].filter((k) => !base.has(k)),
      }).toEqual({ locale, missing: [], extra: [] })
    }
  })
})

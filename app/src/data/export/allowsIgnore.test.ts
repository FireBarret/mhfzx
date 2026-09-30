import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAllowsFile, parseIgnoreFile } from '../import/allowsIgnore'
import { exportAllowsFile, exportIgnoreFile } from './allowsIgnore'

const SETTING_DIR = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/setting'

describe('allows.xml / ignore.xml round-trip fidelity', () => {
  it('re-exports allows.xml byte-for-byte', () => {
    const original = readFileSync(`${SETTING_DIR}/allows.xml`, 'utf-8')
    expect(exportAllowsFile(parseAllowsFile(original))).toBe(original)
  })

  it('re-exports ignore.xml byte-for-byte', () => {
    const original = readFileSync(`${SETTING_DIR}/ignore.xml`, 'utf-8')
    const parsed = parseIgnoreFile(original)
    // Sanity-check the real content landed in the right (correctly-cased)
    // fields before trusting the byte-diff to catch everything.
    expect(parsed.equip).toContain('アメニケ Piercings GP')
    expect(parsed.class).toContain('(パGP)')
    expect(parsed.classJewelry).toContain('(P)')
    expect(exportIgnoreFile(parsed)).toBe(original)
  })
})

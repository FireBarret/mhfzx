import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findChild, getRoot, getText, parseXmlTree, serializeXmlTree, setText } from './xmlTree'

const SETTING_PATH = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/setting/setting.xml'

describe('xmlTree generic round-trip', () => {
  it('reproduces the real, large, deeply-nested setting.xml byte-for-byte unmodified', () => {
    const original = readFileSync(SETTING_PATH, 'utf-8')
    const tree = parseXmlTree(original)
    expect(serializeXmlTree(tree)).toBe(original)
  })

  it('mutating one field changes only that field on re-export', () => {
    const original = readFileSync(SETTING_PATH, 'utf-8')
    const tree = parseXmlTree(original)
    const root = getRoot(tree)
    const threadNum = findChild(root, 'ThreadNum')!
    expect(getText(threadNum)).toBe('6')
    setText(threadNum, '12')

    const exported = serializeXmlTree(tree)
    expect(exported).not.toBe(original)
    expect(exported).toBe(original.replace('<ThreadNum>6</ThreadNum>', '<ThreadNum>12</ThreadNum>'))

    // Re-import and confirm the change stuck, and nothing else moved.
    const reparsed = getRoot(parseXmlTree(exported))
    expect(getText(findChild(reparsed, 'ThreadNum')!)).toBe('12')
    expect(getText(findChild(reparsed, 'StopSearchCount')!)).toBe('100')
  })

  it('reads a self-closing empty element as having zero children', () => {
    const tree = parseXmlTree(readFileSync(SETTING_PATH, 'utf-8'))
    const root = getRoot(tree)
    const favoriteSkills = findChild(root, 'FavoriteSkills')!
    expect(favoriteSkills.children).toEqual([])
  })
})

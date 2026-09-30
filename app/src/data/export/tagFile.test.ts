import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTagFile } from '../import/tagFile'
import { exportTagFile } from './tagFile'

const ROOT = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths'
const TAG_DIR = `${ROOT}/tag`
const ADDITIONAL_TAG_DIRS = [`${ROOT}/-- Additional Tag Files  --/Standard`, `${ROOT}/-- Additional Tag Files  --/Extra`]

function roundTripsByteForByte(fileName: string) {
  const original = readFileSync(`${TAG_DIR}/${fileName}`, 'utf-8')
  const tag = parseTagFile(original)
  const exported = exportTagFile(tag)
  expect(exported).toBe(original)
}

describe('tag/*.xml round-trip fidelity', () => {
  it('re-exports an empty tag (Amatsu.xml) byte-for-byte', () => {
    roundTripsByteForByte('Amatsu.xml')
  })

  it('re-exports a populated, system=true tag (Crafted.xml) byte-for-byte', () => {
    roundTripsByteForByte('Crafted.xml')
  })

  it('re-exports every real tag/*.xml file byte-for-byte', () => {
    const files = readdirSync(TAG_DIR).filter((f) => f.endsWith('.xml'))
    expect(files.length).toBeGreaterThan(100)
    const mismatches: string[] = []
    for (const file of files) {
      const original = readFileSync(`${TAG_DIR}/${file}`, 'utf-8')
      const exported = exportTagFile(parseTagFile(original))
      if (exported !== original) mismatches.push(file)
    }
    expect(mismatches).toEqual([])
  })

  it('re-exports every file in the "-- Additional Tag Files --" pack byte-for-byte', () => {
    const mismatches: string[] = []
    let total = 0
    for (const dir of ADDITIONAL_TAG_DIRS) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.xml'))) {
        total++
        const original = readFileSync(`${dir}/${file}`, 'utf-8')
        const exported = exportTagFile(parseTagFile(original))
        if (exported !== original) mismatches.push(`${dir}/${file}`)
      }
    }
    expect(total).toBeGreaterThan(100)
    expect(mismatches).toEqual([])
  })
})

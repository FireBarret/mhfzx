import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadGameDataFromFileList, MissingFilesError } from './browserLoad'

const ROOT = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths'

// `<input webkitdirectory>` gives File objects whose `webkitRelativePath`
// includes the folder the user picked (e.g. "MHFZ Set Searcher.../dat/EquipHead.xml").
// Node's real File/FileList don't have that browser-only property, so this
// builds one exactly the way the browser would: a real File plus that one
// extra field, exercising the actual matching logic in browserLoad.ts.
function fakeFile(relativePath: string, content: string): File {
  const file = new File([content], relativePath.split('/').pop()!, { type: 'text/xml' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

function fakeFileList(files: File[]): FileList {
  const list = files as unknown as FileList & File[]
  Object.defineProperty(list, 'item', { value: (i: number) => files[i] ?? null })
  return list as unknown as FileList
}

function realFileList(): FileList {
  const root = 'MHFZ Set Searcher for GX and Zeniths'
  const paths = [
    'dat/EquipHead.xml',
    'dat/EquipBody.xml',
    'dat/EquipArm.xml',
    'dat/EquipWst.xml',
    'dat/EquipLeg.xml',
    'dat/Weapon.xml',
    'dat/Jewel.xml',
    'dat/SkillCuff.xml',
    'dat/SkillBase.xml',
    'dat/TeniSkillBase.xml',
    'conf/Define.xml',
    'conf/Clothes.xml',
    // A couple of irrelevant files that would also be present in a real
    // folder selection, to confirm the matcher ignores them correctly.
    'dat/Item.xml',
    'dat/Alias.xml',
  ]
  return fakeFileList(paths.map((p) => fakeFile(`${root}/${p}`, readFileSync(`${ROOT}/${p}`, 'utf-8'))))
}

describe('loadGameDataFromFileList', () => {
  it('loads a real full folder selection into a working GameData', async () => {
    const gameData = await loadGameDataFromFileList(realFileList())
    expect(gameData.head.length).toBeGreaterThan(1000)
    expect(gameData.jewels.length).toBeGreaterThan(1000)
    expect(gameData.skillBase.length).toBeGreaterThan(100)
    expect(gameData.abilityTypes.skillLimitUp).toBe('Skill Slots Up')
  })

  it('throws MissingFilesError listing exactly what is missing when the folder is incomplete', async () => {
    const root = 'MHFZ Set Searcher for GX and Zeniths'
    const partial = fakeFileList([fakeFile(`${root}/dat/EquipHead.xml`, readFileSync(`${ROOT}/dat/EquipHead.xml`, 'utf-8'))])
    await expect(loadGameDataFromFileList(partial)).rejects.toThrow(MissingFilesError)
    try {
      await loadGameDataFromFileList(partial)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MissingFilesError)
      expect((err as MissingFilesError).missing).toContain('/dat/Weapon.xml')
      expect((err as MissingFilesError).missing).not.toContain('/dat/EquipHead.xml')
    }
  })
})

// Dev-only tool: regenerates rust-core/fixtures/real_game_data.json (used by
// rust-core/tests/real_data_search.rs, gitignored — see that file) from the
// real dat/+conf/ files. Vitest's default include glob only matches
// *.test.ts/*.spec.ts, so run it by temporarily copying to a matching name:
//   cp scripts/dumpFixture.manual.ts scripts/_tmpDumpFixture.test.ts && \
//     npx vitest run scripts/_tmpDumpFixture.test.ts; rm scripts/_tmpDumpFixture.test.ts
// Named *.manual.ts (not *.test.ts) so it's never picked up by a plain
// `npx vitest run` (no path) — it writes a 14MB file and reads from a fixed
// local path outside the repo, which isn't appropriate for the normal suite.
// vitest's bundler-style module resolution handles the extensionless
// relative imports in src/data/ that plain `node` can't.
import { readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { assembleGameData } from '../src/data/import/gameData'

it('dumps the real GameData fixture', () => {
  const ROOT = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths'
  const read = (p: string) => readFileSync(`${ROOT}/${p}`, 'utf-8')
  const gameData = assembleGameData({
    equipHead: read('dat/EquipHead.xml'),
    equipBody: read('dat/EquipBody.xml'),
    equipArm: read('dat/EquipArm.xml'),
    equipWaist: read('dat/EquipWst.xml'),
    equipLeg: read('dat/EquipLeg.xml'),
    weapon: read('dat/Weapon.xml'),
    jewel: read('dat/Jewel.xml'),
    skillCuff: read('dat/SkillCuff.xml'),
    skillBase: read('dat/SkillBase.xml'),
    teniSkillBase: read('dat/TeniSkillBase.xml'),
    define: read('conf/Define.xml'),
  })
  writeFileSync('/Users/dariush/Projects/mhfz-set-searcher/rust-core/fixtures/real_game_data.json', JSON.stringify(gameData))
})

// The Search tab — restructured to mirror the original MHSX2G layout: a
// search-conditions bar, a skill-target table (No/Skill/Value/Activated
// Name, like the original's grid, not free-floating rows), a search control
// bar, a dense multi-column results grid, and a master-detail pane showing
// the selected result's full per-slot equipment breakdown + active skills —
// matching the original's results-list-on-the-left/detail-on-the-right
// interaction (click a result row to inspect it).

import type { EquipData, SkillBaseEntry } from '../data/schema'
import { appState } from './appState'
import { runSearch, type FoundSet, type JobFilter, type SearchTarget } from '../search'

interface TargetRow {
  skillName: string
  minPoint: number
}

let targets: TargetRow[] = []
let lastResults: FoundSet[] = []
let selectedIndex: number | null = null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function skillOptionsHtml(skill: SkillBaseEntry, selected: number): string {
  const positive = skill.options.filter((o) => o.point > 0).sort((a, b) => a.point - b.point)
  return positive
    .map((o) => `<option value="${o.point}" ${o.point === selected ? 'selected' : ''}>${escapeHtml(o.name)}</option>`)
    .join('')
}

// --- Target skill table (mirrors the original's No/Skill/Value/Activated Name grid) ---

function renderTargetTable(root: HTMLElement) {
  const body = root.querySelector<HTMLTableSectionElement>('#target-table-body')!
  const skillBase = appState.gameData?.skillBase ?? []
  const byName = new Map(skillBase.map((s) => [s.name, s]))

  body.innerHTML = targets
    .map((t, i) => {
      const skill = byName.get(t.skillName)
      const optionsHtml = skill ? skillOptionsHtml(skill, t.minPoint) : ''
      const activated = skill?.options.find((o) => o.point === t.minPoint)?.name ?? ''
      return `<tr data-index="${i}">
        <td>${i + 1}</td>
        <td>${escapeHtml(t.skillName)}</td>
        <td><select class="tier-select" data-index="${i}">${optionsHtml}</select></td>
        <td class="activated-name">${escapeHtml(activated)}</td>
        <td><button class="remove-target" data-index="${i}" title="Remove">×</button></td>
      </tr>`
    })
    .join('')

  body.querySelectorAll<HTMLSelectElement>('.tier-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.index)
      targets[i].minPoint = Number(sel.value)
      renderTargetTable(root)
    })
  })
  body.querySelectorAll<HTMLButtonElement>('.remove-target').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index)
      targets.splice(i, 1)
      renderTargetTable(root)
    })
  })
}

// --- Results grid + master-detail selection ---

function skillCellsHtml(skills: FoundSet['activeSkills']): string {
  const cells: string[] = []
  for (let i = 0; i < 5; i++) {
    const s = skills[i]
    cells.push(`<td>${s ? escapeHtml(s.optionName) : ''}</td>`)
  }
  return cells.join('')
}

function renderResultsTable(root: HTMLElement) {
  const body = root.querySelector<HTMLTableSectionElement>('#results-body')!
  body.innerHTML = lastResults
    .map(
      (r, i) => `<tr data-index="${i}" class="${i === selectedIndex ? 'selected' : ''}">
        <td>${i}</td>
        <td>${r.totalDefense}</td>
        <td>${r.activeSkills.length}</td>
        <td>${escapeHtml(r.weapon ?? '—')}</td>
        <td>${escapeHtml(r.head)}</td>
        <td>${escapeHtml(r.body)}</td>
        <td>${escapeHtml(r.arm)}</td>
        <td>${escapeHtml(r.waist)}</td>
        <td>${escapeHtml(r.leg)}</td>
        <td>${escapeHtml(r.decorations.join(', ') || '—')}</td>
        ${skillCellsHtml(r.activeSkills)}
      </tr>`,
    )
    .join('')

  body.querySelectorAll<HTMLTableRowElement>('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      selectedIndex = Number(tr.dataset.index)
      renderResultsTable(root)
      renderDetailPanes(root)
    })
  })
}

function findEquip(category: EquipData[], name: string): EquipData | undefined {
  return category.find((d) => d.name === name)
}

function equipDetailRow(part: string, data: EquipData | undefined): string {
  if (!data) return `<tr><td>${part}</td><td colspan="8">—</td></tr>`
  const best = data.levels[data.levels.length - 1]
  const skillCells = Array.from({ length: 5 }, (_, i) => {
    const s = data.skills[i]
    return `<td>${s ? escapeHtml(`${s.skillName} ${s.point > 0 ? '+' : ''}${s.point}`) : ''}</td>`
  }).join('')
  return `<tr>
    <td>${part}</td>
    <td>${escapeHtml(data.name)}</td>
    <td>${escapeHtml(data.class)}</td>
    <td>${best?.def ?? '—'}</td>
    ${skillCells}
    <td>${best?.slot ?? 0}</td>
    <td>${data.rare}</td>
  </tr>`
}

function renderDetailPanes(root: HTMLElement) {
  const equipBody = root.querySelector<HTMLTableSectionElement>('#detail-equip-body')!
  const skillsBody = root.querySelector<HTMLTableSectionElement>('#detail-skills-body')!
  const decoNote = root.querySelector<HTMLDivElement>('#detail-decorations')!

  const gameData = appState.gameData
  if (selectedIndex === null || !gameData) {
    equipBody.innerHTML = ''
    skillsBody.innerHTML = ''
    decoNote.textContent = ''
    return
  }
  const r = lastResults[selectedIndex]
  const weapon = r.weapon ? gameData.weapons.find((w) => w.name === r.weapon) : undefined
  equipBody.innerHTML = [
    weapon
      ? `<tr><td>Weapon</td><td>${escapeHtml(weapon.name)}</td><td>—</td><td>${weapon.levels[weapon.levels.length - 1]?.atk ?? '—'}</td>${Array.from({ length: 5 }, (_, i) => {
          const s = weapon.skills[i]
          return `<td>${s ? escapeHtml(`${s.skillName} ${s.point > 0 ? '+' : ''}${s.point}`) : ''}</td>`
        }).join('')}<td>${weapon.levels[weapon.levels.length - 1]?.slot ?? 0}</td><td>${weapon.rare}</td></tr>`
      : `<tr><td>Weapon</td><td colspan="8">—</td></tr>`,
    equipDetailRow('Head', findEquip(gameData.head, r.head)),
    equipDetailRow('Body', findEquip(gameData.body, r.body)),
    equipDetailRow('Arm', findEquip(gameData.arm, r.arm)),
    equipDetailRow('Waist', findEquip(gameData.waist, r.waist)),
    equipDetailRow('Leg', findEquip(gameData.leg, r.leg)),
  ].join('')

  skillsBody.innerHTML = r.activeSkills
    .map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.skillName)}</td><td>${s.point}</td><td>${escapeHtml(s.optionName)}</td></tr>`)
    .join('')

  decoNote.textContent = r.decorations.length > 0 ? `Decorations used: ${r.decorations.join(', ')}` : 'No decorations used.'
}

function setResultsSummary(root: HTMLElement, text: string) {
  root.querySelector<HTMLDivElement>('#results-summary')!.textContent = text
}

export function renderSearchView(container: HTMLElement) {
  container.innerHTML = `
    <div class="mhfz-layout">
      <fieldset class="search-conditions-bar">
        <legend>Search Conditions</legend>
        <div class="conditions-row">
          <label>Job
            <select id="job-filter">
              <option value="Both">Both</option>
              <option value="Blademaster">Blademaster</option>
              <option value="Gunner">Gunner</option>
            </select>
          </label>
          <label>Max Results <input id="max-results" type="number" value="20" min="1" max="500"></label>
          <button id="run-search-btn" class="primary">Start Search</button>
        </div>
      </fieldset>

      <div class="skill-pick-row">
        <fieldset class="skill-pick-fieldset">
          <legend>Add Skill</legend>
          <div class="add-skill-row">
            <select id="add-skill-select"></select>
            <button id="add-skill-btn">Add</button>
          </div>
          <div class="skill-tier-note">Tiers shown are the game's real thresholds for each skill.</div>
        </fieldset>
        <fieldset class="target-table-fieldset">
          <legend>Target Skills</legend>
          <div class="table-scroll" style="max-height:140px;">
            <table>
              <thead><tr><th>No.</th><th>Skill</th><th>Value</th><th>Activated Skill</th><th></th></tr></thead>
              <tbody id="target-table-body"></tbody>
            </table>
          </div>
        </fieldset>
      </div>

      <div class="results-summary" id="results-summary">Load a data folder, then add target skills and start a search.</div>

      <div class="table-scroll results-scroll">
        <table>
          <thead><tr>
            <th>No.</th><th>Def</th><th>#Sk</th><th>Weapon</th><th>Head</th><th>Body</th><th>Arm</th><th>Waist</th><th>Leg</th><th>Decorations</th>
            <th>Skill 1</th><th>Skill 2</th><th>Skill 3</th><th>Skill 4</th><th>Skill 5</th>
          </tr></thead>
          <tbody id="results-body"></tbody>
        </table>
      </div>

      <div class="detail-panes">
        <fieldset class="detail-equip-fieldset">
          <legend>Selected Set — Equipment</legend>
          <div class="table-scroll" style="max-height:170px;">
            <table>
              <thead><tr>
                <th>Part</th><th>Name</th><th>Class</th><th>Def/Atk</th>
                <th>Skill 1</th><th>Skill 2</th><th>Skill 3</th><th>Skill 4</th><th>Skill 5</th>
                <th>Slot</th><th>Rare</th>
              </tr></thead>
              <tbody id="detail-equip-body"></tbody>
            </table>
          </div>
          <div id="detail-decorations" class="skill-tier-note"></div>
        </fieldset>
        <fieldset class="detail-skills-fieldset">
          <legend>Selected Set — Active Skills</legend>
          <div class="table-scroll" style="max-height:170px;">
            <table>
              <thead><tr><th>No.</th><th>Skill</th><th>Value</th><th>Activated Skill</th></tr></thead>
              <tbody id="detail-skills-body"></tbody>
            </table>
          </div>
        </fieldset>
      </div>
    </div>
  `

  const addSelect = container.querySelector<HTMLSelectElement>('#add-skill-select')!
  const addBtn = container.querySelector<HTMLButtonElement>('#add-skill-btn')!
  const runBtn = container.querySelector<HTMLButtonElement>('#run-search-btn')!
  const jobSelect = container.querySelector<HTMLSelectElement>('#job-filter')!
  const maxResultsInput = container.querySelector<HTMLInputElement>('#max-results')!

  function populateSkillSelect() {
    const skillBase = appState.gameData?.skillBase ?? []
    const sorted = [...skillBase].sort((a, b) => a.name.localeCompare(b.name))
    addSelect.innerHTML = sorted.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('')
  }

  addBtn.addEventListener('click', () => {
    const skillName = addSelect.value
    if (!skillName || targets.some((t) => t.skillName === skillName)) return
    const skillBase = appState.gameData?.skillBase ?? []
    const skill = skillBase.find((s) => s.name === skillName)
    const lowestPositive = skill?.options.filter((o) => o.point > 0).sort((a, b) => a.point - b.point)[0]
    targets.push({ skillName, minPoint: lowestPositive?.point ?? 1 })
    renderTargetTable(container)
  })

  runBtn.addEventListener('click', () => {
    const gameData = appState.gameData
    selectedIndex = null
    if (!gameData) {
      lastResults = []
      renderResultsTable(container)
      renderDetailPanes(container)
      setResultsSummary(container, 'Load a data folder first.')
      return
    }
    if (!appState.wasmReady) {
      setResultsSummary(container, 'The search engine is still starting up — wait a moment and try again.')
      return
    }
    if (targets.length === 0) {
      setResultsSummary(container, 'Add at least one target skill.')
      return
    }
    const request = {
      targets: targets.map((t): SearchTarget => ({ skillName: t.skillName, minPoint: t.minPoint })),
      job: jobSelect.value as JobFilter,
      maxResults: Number(maxResultsInput.value) || 20,
    }
    const start = performance.now()
    try {
      lastResults = runSearch(gameData, request)
    } catch (err) {
      console.error('Search failed:', err)
      lastResults = []
      renderResultsTable(container)
      renderDetailPanes(container)
      setResultsSummary(container, `Search failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    const ms = (performance.now() - start).toFixed(1)
    renderResultsTable(container)
    renderDetailPanes(container)
    setResultsSummary(
      container,
      lastResults.length > 0
        ? `${lastResults.length} set${lastResults.length === 1 ? '' : 's'} found (${ms}ms) — click a row to inspect it.`
        : `No sets found matching those targets (${ms}ms). Try lower thresholds or fewer skills.`,
    )
  })

  appState.onDataLoaded(() => {
    populateSkillSelect()
    renderTargetTable(container)
  })
  populateSkillSelect()
  renderTargetTable(container)
  renderResultsTable(container)
  renderDetailPanes(container)
}

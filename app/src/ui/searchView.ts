// The Search tab: a skill-target condition panel on the left (mirroring the
// original's search-condition panel) and a results grid on the right
// (mirroring the original's search-result grid columns — Weapon/Head/Body/
// Arm/Waist/Leg/Decorations/Defense/Skills).

import type { SkillBaseEntry } from '../data/schema'
import { appState } from './appState'
import { runSearch, type FoundSet, type JobFilter, type SearchTarget } from '../search'

interface TargetRow {
  skillName: string
  minPoint: number
}

let targets: TargetRow[] = []

function skillOptionsHtml(skill: SkillBaseEntry): string {
  const positive = skill.options.filter((o) => o.point > 0).sort((a, b) => a.point - b.point)
  return positive.map((o) => `<option value="${o.point}">${escapeHtml(o.name)} (${o.point} pts)</option>`).join('')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderTargetList(root: HTMLElement) {
  const list = root.querySelector<HTMLDivElement>('#target-list')!
  const skillBase = appState.gameData?.skillBase ?? []
  const byName = new Map(skillBase.map((s) => [s.name, s]))

  list.innerHTML = targets
    .map((t, i) => {
      const skill = byName.get(t.skillName)
      const optionsHtml = skill ? skillOptionsHtml(skill) : ''
      return `
        <div class="target-row" data-index="${i}">
          <span class="skill-name" title="${escapeHtml(t.skillName)}">${escapeHtml(t.skillName)}</span>
          <select class="tier-select" data-index="${i}">${optionsHtml}</select>
          <button class="remove-target" data-index="${i}" title="Remove">×</button>
        </div>`
    })
    .join('')

  list.querySelectorAll<HTMLSelectElement>('.tier-select').forEach((sel) => {
    const i = Number(sel.dataset.index)
    sel.value = String(targets[i].minPoint)
    sel.addEventListener('change', () => {
      targets[i].minPoint = Number(sel.value)
    })
  })
  list.querySelectorAll<HTMLButtonElement>('.remove-target').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index)
      targets.splice(i, 1)
      renderTargetList(root)
    })
  })
}

function renderResults(root: HTMLElement, results: FoundSet[] | null, message?: string) {
  const summary = root.querySelector<HTMLDivElement>('#results-summary')!
  const body = root.querySelector<HTMLTableSectionElement>('#results-body')!

  if (message) {
    summary.textContent = message
    body.innerHTML = ''
    return
  }
  if (!results) return

  summary.textContent = `${results.length} set${results.length === 1 ? '' : 's'} found`
  body.innerHTML = results
    .map((r) => {
      const skillsText = r.activeSkills
        .map((s) => `${s.skillName} ${s.optionName.replace(s.skillName, '').trim() || `(${s.point})`}`)
        .join(', ')
      return `<tr>
        <td>${escapeHtml(r.weapon ?? '—')}</td>
        <td>${escapeHtml(r.head)}</td>
        <td>${escapeHtml(r.body)}</td>
        <td>${escapeHtml(r.arm)}</td>
        <td>${escapeHtml(r.waist)}</td>
        <td>${escapeHtml(r.leg)}</td>
        <td>${escapeHtml(r.decorations.join(', ') || '—')}</td>
        <td>${r.totalDefense}</td>
        <td>${escapeHtml(skillsText)}</td>
      </tr>`
    })
    .join('')
}

export function renderSearchView(container: HTMLElement) {
  container.innerHTML = `
    <div class="search-layout">
      <div class="search-conditions">
        <fieldset>
          <legend>Job</legend>
          <select id="job-filter">
            <option value="Both">Both</option>
            <option value="Blademaster">Blademaster</option>
            <option value="Gunner">Gunner</option>
          </select>
        </fieldset>
        <fieldset>
          <legend>Target Skills</legend>
          <div class="skill-tier-note">Pick a skill, then how strong you want it — the tiers shown are the game's real thresholds.</div>
          <div id="target-list"></div>
          <div class="add-skill-row">
            <select id="add-skill-select"></select>
            <button id="add-skill-btn">Add</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Options</legend>
          <div class="field-row">Max Results <input id="max-results" type="number" value="20" min="1" max="500" style="width:60px"></div>
        </fieldset>
        <button id="run-search-btn" class="primary" style="width:100%; padding:8px;">Search</button>
      </div>
      <div class="search-results">
        <div class="results-summary" id="results-summary">Load a data folder, then add target skills and search.</div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Weapon</th><th>Head</th><th>Body</th><th>Arm</th><th>Waist</th><th>Leg</th>
              <th>Decorations</th><th>Defense</th><th>Active Skills</th>
            </tr></thead>
            <tbody id="results-body"></tbody>
          </table>
        </div>
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
    renderTargetList(container)
  })

  runBtn.addEventListener('click', () => {
    const gameData = appState.gameData
    if (!gameData) {
      renderResults(container, null, 'Load a data folder first.')
      return
    }
    if (!appState.wasmReady) {
      renderResults(container, null, 'The search engine is still starting up — wait a moment and try again.')
      return
    }
    if (targets.length === 0) {
      renderResults(container, null, 'Add at least one target skill.')
      return
    }
    const request = {
      targets: targets.map((t): SearchTarget => ({ skillName: t.skillName, minPoint: t.minPoint })),
      job: jobSelect.value as JobFilter,
      maxResults: Number(maxResultsInput.value) || 20,
    }
    let results: FoundSet[]
    const start = performance.now()
    try {
      results = runSearch(gameData, request)
    } catch (err) {
      // Surface the real error instead of failing silently — a thrown
      // exception here previously produced no visible feedback at all.
      console.error('Search failed:', err)
      renderResults(container, null, `Search failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    const ms = (performance.now() - start).toFixed(1)
    renderResults(container, results)
    if (results.length > 0) {
      const summary = container.querySelector<HTMLDivElement>('#results-summary')!
      summary.textContent += ` (${ms}ms)`
    } else {
      renderResults(container, null, `No sets found matching those targets (${ms}ms). Try lower thresholds or fewer skills.`)
    }
  })

  appState.onDataLoaded(() => {
    populateSkillSelect()
    renderTargetList(container)
  })
  populateSkillSelect()
  renderTargetList(container)
}

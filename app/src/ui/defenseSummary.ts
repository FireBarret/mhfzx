// Shared Def + elemental resistance breakdown: one row per armor slot
// (Head/Torso/Arms/Waist/Legs) plus a Total row. Used by the Search tab (for
// the selected result) and the Data Browser (for the current preset slots) --
// callers pass in resolved pieces, so this stays free of search/preset state.
// Weapon is deliberately excluded: the evaluator's own totals exclude it too.

import type { EquipData } from '../data/schema'

export interface SlotPiece {
  label: string
  data: EquipData | undefined
}

const ELEMENTS = ['fire', 'water', 'thunder', 'ice', 'dragon'] as const
const ELEMENT_LABELS = ['Fire', 'Water', 'Thunder', 'Ice', 'Dragon']

function fmt(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

export function defenseSummaryHtml(pieces: SlotPiece[]): string {
  const totals = { def: 0, fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 }
  const rows = pieces.map(({ label, data }) => {
    if (!data) {
      return `<tr><td>${label}</td><td colspan="6">—</td></tr>`
    }
    const best = data.levels[data.levels.length - 1]
    const def = best?.def ?? 0
    totals.def += def
    for (const el of ELEMENTS) totals[el] += data.elemental[el]
    return `<tr><td>${label}</td><td>${def}</td>${ELEMENTS.map((el) => `<td>${fmt(data.elemental[el])}</td>`).join('')}</tr>`
  })
  const header = `<tr><th>Part</th><th>Def</th>${ELEMENT_LABELS.map((l) => `<th>${l}</th>`).join('')}</tr>`
  const total = `<tr class="defense-total"><td>Total</td><td>${totals.def}</td>${ELEMENTS.map((el) => `<td>${fmt(totals[el])}</td>`).join('')}</tr>`
  return `<table class="defense-summary"><thead>${header}</thead><tbody>${rows.join('')}${total}</tbody></table>`
}

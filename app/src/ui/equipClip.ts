// "Equipment clip" export: the original app's MHSX2.Clip.Mhsx2TextClip /
// Mhsx2ImageClip (decompiled source) let you copy the selected set to the
// clipboard as formatted text, or render it to an image and copy/save that
// as a .png. This reimplements the same idea against this app's own data
// shape (FoundSet + GameData lookups) rather than porting the original's
// exact resource-string wording, since this UI is English throughout.
//
// Structure mirrors the original: weapon + 5 armor lines (name, class,
// level, def/atk, slot-fill dots, decorations used on that piece), a total
// defense + elemental resistance line, then three skill sections -- Zenith
// (辿異/Teni, membership-only tree skills -- "Teni" in internal code/data,
// but the game calls these "Zenith Skills" in English), Passive
// (Senyu-granted, pre-satisfied), and Active (everything else) -- matching
// the original's three-way split in Mhsx2TextClip.ToString().

import type { EquipData, GameData, WeaponData } from '../data/schema'
import type { FoundSet, JobFilter } from '../search'

function usedSlotUnits(decorationNames: string[], gameData: GameData): number {
  return decorationNames.reduce((sum, name) => sum + (gameData.jewels.find((j) => j.name === name)?.slot ?? 0), 0)
}

function slotDots(totalSlots: number, usedSlots: number): string {
  const filled = '●'.repeat(Math.max(0, Math.min(usedSlots, totalSlots)))
  const empty = '○'.repeat(Math.max(0, totalSlots - usedSlots))
  return filled + empty || '—'
}

interface PartLine {
  label: string
  name: string
  cls: string
  level: string
  statLabel: string
  stat: string
  slots: string
  decorations: string
}

function buildPartLine(
  label: string,
  data: EquipData | WeaponData | undefined,
  decoNames: string[],
  gameData: GameData,
  isWeapon: boolean,
): PartLine {
  if (!data) {
    return { label, name: '(none)', cls: '', level: '', statLabel: '', stat: '', slots: '', decorations: '' }
  }
  const best = data.levels[data.levels.length - 1]
  const totalSlots = best?.slot ?? 0
  const used = usedSlotUnits(decoNames, gameData)
  return {
    label,
    name: data.name,
    cls: isWeapon ? '' : (data as EquipData).class,
    level: `Lv${best?.level ?? data.levels.length}`,
    statLabel: isWeapon ? 'Atk' : 'Def',
    stat: String((isWeapon ? (best as { atk?: number }).atk : (best as { def?: number }).def) ?? '—'),
    slots: slotDots(totalSlots, used),
    decorations: decoNames.length > 0 ? decoNames.join(', ') : '—',
  }
}

function fmtResistance(n: number): string {
  return n >= 0 ? `+${n}` : String(n)
}

/** Builds the plain-text equipment clip for `result`, resolving each
 * piece's class/level/def/slots from `gameData` by name. `job` is the
 * search's job filter at the time of the search (not re-derived from the
 * pieces), matching how the original titles the clip by the search
 * condition, not an inferred value. */
export function formatEquipTextClip(result: FoundSet, gameData: GameData, job: JobFilter): string {
  const weapon = result.weapon ? gameData.weapons.find((w) => w.name === result.weapon) : undefined
  const lines: PartLine[] = [
    buildPartLine('Weapon', weapon, result.weaponDecorations, gameData, true),
    buildPartLine('Head', gameData.head.find((p) => p.name === result.head), result.headDecorations, gameData, false),
    buildPartLine('Body', gameData.body.find((p) => p.name === result.body), result.bodyDecorations, gameData, false),
    buildPartLine('Arm', gameData.arm.find((p) => p.name === result.arm), result.armDecorations, gameData, false),
    buildPartLine('Waist', gameData.waist.find((p) => p.name === result.waist), result.waistDecorations, gameData, false),
    buildPartLine('Leg', gameData.leg.find((p) => p.name === result.leg), result.legDecorations, gameData, false),
  ]

  const out: string[] = []
  out.push(`MHFZ Set — Job: ${job}`)
  out.push('')
  for (const l of lines) {
    out.push(`${l.label.padEnd(7)} ${l.name}`)
    if (l.level) {
      const statPart = l.stat ? `${l.statLabel} ${l.stat}` : ''
      out.push(`        ${[l.cls, l.level, statPart].filter(Boolean).join('  ')}`)
      out.push(`        ${l.slots}  ${l.decorations}`)
    }
  }
  out.push('')
  const r = result.resistances
  out.push(
    `Total Defense: ${result.totalDefense}   Fire:${fmtResistance(r.fire)} Water:${fmtResistance(r.water)} Thunder:${fmtResistance(r.thunder)} Ice:${fmtResistance(r.ice)} Dragon:${fmtResistance(r.dragon)}`,
  )
  out.push('')

  if (result.teniSkillNames.length > 0) {
    out.push('Zenith Skills:')
    out.push(result.teniSkillNames.join(', '))
    out.push('')
  }

  const passive = result.activeSkills.filter((s) => s.fromSenyu)
  const active = result.activeSkills.filter((s) => !s.fromSenyu)
  if (passive.length > 0) {
    out.push('Passive Skills:')
    out.push(passive.map((s) => s.optionName).join(', '))
    out.push('')
  }
  out.push('Active Skills:')
  out.push(active.length > 0 ? active.map((s) => s.optionName).join(', ') : '(none)')

  return out.join('\n')
}

export async function copyTextClipToClipboard(result: FoundSet, gameData: GameData, job: JobFilter): Promise<void> {
  await navigator.clipboard.writeText(formatEquipTextClip(result, gameData, job))
}

const IMAGE_FONT_SIZE = 14
const IMAGE_LINE_HEIGHT = IMAGE_FONT_SIZE * 1.5
const IMAGE_PADDING = 16
const IMAGE_FONT = `${IMAGE_FONT_SIZE}px "Courier New", monospace`

/** Renders the same text clip onto a canvas (white background, black
 * monospace text, one line per row) and returns it as a PNG blob --
 * mirrors Mhsx2ImageClip.ToImage()'s plain text-on-bitmap approach, just
 * via the Canvas API instead of System.Drawing. */
export function renderEquipImageClip(result: FoundSet, gameData: GameData, job: JobFilter): Promise<Blob> {
  const text = formatEquipTextClip(result, gameData, job)
  const textLines = text.split('\n')

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')!
  measureCtx.font = IMAGE_FONT
  const widest = Math.max(...textLines.map((l) => measureCtx.measureText(l).width))

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(widest) + IMAGE_PADDING * 2
  canvas.height = Math.ceil(textLines.length * IMAGE_LINE_HEIGHT) + IMAGE_PADDING * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.font = IMAGE_FONT
  ctx.textBaseline = 'top'
  textLines.forEach((line, i) => ctx.fillText(line, IMAGE_PADDING, IMAGE_PADDING + i * IMAGE_LINE_HEIGHT))

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))), 'image/png')
  })
}

/** Copies the rendered image to the clipboard. Browser support for
 * clipboard image writes varies (notably weaker on Firefox) -- callers
 * should catch and fall back to `downloadImageClip`. */
export async function copyImageClipToClipboard(result: FoundSet, gameData: GameData, job: JobFilter): Promise<void> {
  const blob = await renderEquipImageClip(result, gameData, job)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export async function downloadImageClip(result: FoundSet, gameData: GameData, job: JobFilter): Promise<void> {
  const blob = await renderEquipImageClip(result, gameData, job)
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${[result.head, result.body].filter((n) => n && n !== '(none)').join('-') || 'mhfz-set'}.png`
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

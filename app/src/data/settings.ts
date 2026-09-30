// Typed accessors over setting/setting.xml's generic XmlTree (xmlTree.ts).
// Only the fields the app actually reads/writes are modeled here — this is
// the "opaque passthrough" design from the project plan: everything else in
// the file (window bounds, grid column widths, EditHistory, image-server
// URLs, ...) is left untouched in the tree and round-trips automatically.
//
// Boolean/number leaf fields (ThreadNum, the Optimize*/AcceptFirstFound*
// flags, ...) get both a read and a write accessor, since mutating a single
// text node in place is simple and safe. SkillSets is read-only for now —
// restructuring it (adding/removing a SkillSet, matching the sibling
// indentation convention for a newly-inserted element) is deferred to when
// the SkillSet builder UI (project plan Phase 5) actually needs it.

import { findChild, findChildren, getText, isElement, setText, type XmlElementNode, type XmlNode } from './xmlTree'

function textOf(root: XmlElementNode, tag: string): string {
  const el = findChild(root, tag)
  if (!el) throw new Error(`setting.xml: missing <${tag}>`)
  return getText(el)
}

function setTextOf(root: XmlElementNode, tag: string, value: string): void {
  const el = findChild(root, tag)
  if (!el) throw new Error(`setting.xml: missing <${tag}>`)
  setText(el, value)
}

function boolOf(root: XmlElementNode, tag: string): boolean {
  return textOf(root, tag) === 'true'
}

function setBoolOf(root: XmlElementNode, tag: string, value: boolean): void {
  setTextOf(root, tag, value ? 'true' : 'false')
}

function numOf(root: XmlElementNode, tag: string): number {
  return Number(textOf(root, tag))
}

function setNumOf(root: XmlElementNode, tag: string, value: number): void {
  setTextOf(root, tag, String(value))
}

export interface SkillSet {
  name: string
  list: string[]
}

/** A thin, mutable view over the parsed `<Settings>` root element. Every
 * getter/setter reads or writes straight through to the underlying tree, so
 * calling `serializeXmlTree` on the original parsed array after using this
 * view reflects all changes made through it. */
export class SettingsView {
  private readonly root: XmlElementNode

  constructor(root: XmlElementNode) {
    this.root = root
  }

  get threadNum(): number {
    return numOf(this.root, 'ThreadNum')
  }
  set threadNum(value: number) {
    setNumOf(this.root, 'ThreadNum', value)
  }

  get stopSearchCount(): number {
    return numOf(this.root, 'StopSearchCount')
  }
  set stopSearchCount(value: number) {
    setNumOf(this.root, 'StopSearchCount', value)
  }

  get optimizeEquip(): boolean {
    return boolOf(this.root, 'OptimizeEquip')
  }
  set optimizeEquip(value: boolean) {
    setBoolOf(this.root, 'OptimizeEquip', value)
  }

  get optimizeJewelry(): boolean {
    return boolOf(this.root, 'OptimizeJewelry')
  }
  set optimizeJewelry(value: boolean) {
    setBoolOf(this.root, 'OptimizeJewelry', value)
  }

  get optimizeJewelryCombination(): boolean {
    return boolOf(this.root, 'OptimizeJewelryCombination')
  }
  set optimizeJewelryCombination(value: boolean) {
    setBoolOf(this.root, 'OptimizeJewelryCombination', value)
  }

  get countRequiredSkillCount(): boolean {
    return boolOf(this.root, 'CountRequiredSkillCount')
  }
  set countRequiredSkillCount(value: boolean) {
    setBoolOf(this.root, 'CountRequiredSkillCount', value)
  }

  get acceptFirstFoundSkillCuffCombination(): boolean {
    return boolOf(this.root, 'AcceptFirstFoundSkillCuffCombination')
  }
  set acceptFirstFoundSkillCuffCombination(value: boolean) {
    setBoolOf(this.root, 'AcceptFirstFoundSkillCuffCombination', value)
  }

  get acceptFirstFoundDecorationCombination(): boolean {
    return boolOf(this.root, 'AcceptFirstFoundDecorationCombination')
  }
  set acceptFirstFoundDecorationCombination(value: boolean) {
    setBoolOf(this.root, 'AcceptFirstFoundDecorationCombination', value)
  }

  get ensureActiveSkillCount(): boolean {
    return boolOf(this.root, 'EnsureActiveSkillCount')
  }
  set ensureActiveSkillCount(value: boolean) {
    setBoolOf(this.root, 'EnsureActiveSkillCount', value)
  }

  get sex(): string {
    return textOf(this.root, 'sex')
  }
  set sex(value: string) {
    setTextOf(this.root, 'sex', value)
  }

  get defLower(): number {
    return numOf(this.root, 'def_lower')
  }
  get rareLower(): number {
    return numOf(this.root, 'rare_lower')
  }
  get rareUpper(): number {
    return numOf(this.root, 'rare_upper')
  }

  /** Read-only: see the class doc comment for why writes aren't modeled yet. */
  get skillSets(): SkillSet[] {
    const container = findChild(this.root, 'SkillSets')
    if (!container) return []
    return findChildren(container, 'SkillSet').map((el) => {
      const nameEl = findChild(el, 'name')
      const listEl = findChild(el, 'list')
      const strings = listEl ? findChildren(listEl, 'string').map(getText) : []
      return { name: nameEl ? getText(nameEl) : '', list: strings }
    })
  }
}

export function settingsViewFrom(tree: XmlNode[]): SettingsView {
  const root = tree.find((n): n is XmlElementNode => isElement(n) && n.tag === 'Settings')
  if (!root) throw new Error('not a Settings document (no <Settings> root found)')
  return new SettingsView(root)
}

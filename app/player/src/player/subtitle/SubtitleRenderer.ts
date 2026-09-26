import type { SubtitleSettings } from '@/store/settings'
import type { SubtitleCue } from '@/subtitle/types'

type Row = 'top' | 'middle' | 'bottom'
type Column = 'left' | 'center' | 'right'

const ROWS: readonly Row[] = ['top', 'middle', 'bottom']

/** Numpad alignment (ASS `\an`) → row. */
const rowOf = (align: number): Row =>
  align >= 7 ? 'top' : align >= 4 ? 'middle' : 'bottom'

/** Numpad alignment → column. */
const columnOf = (align: number): Column => {
  const column = (align - 1) % 3
  return column === 0 ? 'left' : column === 2 ? 'right' : 'center'
}

/** Everything that changes what a cue looks like on screen. */
const cueKey = (cue: SubtitleCue): string =>
  [
    cue.align ?? 2,
    cue.pos ? `${cue.pos.x},${cue.pos.y}` : '',
    cue.scale ?? 1,
    cue.italic ? 1 : 0,
    cue.marginV ?? 0,
    cue.text,
  ].join('|')

const div = (className: string): HTMLDivElement => {
  const node = document.createElement('div')
  node.className = className
  return node
}

/**
 * Draws the active subtitle cues into the stage's subtitle layer.
 *
 * Imperative on purpose: the timing controller calls `render` from a frame
 * callback (or a seek command), and the lines reach the DOM in that same task
 * — no store write, no React render, no persistence on the way. Styling lives
 * in `public/app.css` (`.sub-*`); this class only sets the custom properties
 * and classes behind it, so a settings change is a style recalculation, and
 * switching subtitles on is a repaint of lines that are already laid out.
 *
 * Layout follows the conventions a fansub track is written against (libass):
 * numpad alignment picks the top / middle / bottom row, `\pos` places a sign on
 * the picture (the video's contain box, not the letterbox), and lines sharing
 * a row stack — a larger margin further from the edge, an earlier event
 * nearest the edge.
 */
export class SubtitleRenderer {
  private readonly root: HTMLDivElement
  private readonly rows: Record<Row, HTMLDivElement>
  private readonly frame: HTMLDivElement
  private signature = ''
  /** Last reported control-bar height, so a repeat report is a no-op. */
  private barHeight = -1

  constructor(layer: HTMLElement) {
    // The layer belongs to React (it renders no children into it); everything
    // below it belongs to this class.
    this.root = div('sub-root')
    this.frame = div('sub-frame')
    this.rows = {
      top: div('sub-row sub-row-top'),
      middle: div('sub-row sub-row-middle'),
      bottom: div('sub-row sub-row-bottom'),
    }
    this.root.append(
      this.frame,
      this.rows.top,
      this.rows.middle,
      this.rows.bottom
    )
    layer.replaceChildren(this.root)
  }

  /** Show exactly these cues (the controller passes them in start order). */
  render(active: readonly SubtitleCue[]): void {
    const signature = active.map(cueKey).join('\n')
    // The same lines again — the full track replacing the quick first read, a
    // re-mount after a generated batch — must not touch the DOM.
    if (signature === this.signature) return
    this.signature = signature

    const grouped: Record<Row, Array<{ cue: SubtitleCue; order: number }>> = {
      top: [],
      middle: [],
      bottom: [],
    }
    const signs: SubtitleCue[] = []
    active.forEach((cue, order) => {
      if (cue.pos) signs.push(cue)
      else grouped[rowOf(cue.align ?? 2)].push({ cue, order })
    })
    // Rows fill top to bottom. At the bottom a larger margin sits higher and,
    // on a tie, the earlier event stays nearest the edge; the top mirrors it.
    grouped.bottom.sort(
      (a, b) => (b.cue.marginV ?? 0) - (a.cue.marginV ?? 0) || b.order - a.order
    )
    grouped.top.sort(
      (a, b) => (a.cue.marginV ?? 0) - (b.cue.marginV ?? 0) || a.order - b.order
    )
    for (const row of ROWS) {
      this.rows[row].replaceChildren(
        ...grouped[row].map(({ cue }) => this.line(cue))
      )
    }
    this.frame.replaceChildren(...signs.map((cue) => this.sign(cue)))
  }

  /** Visibility, size, position, opacity and outline from the user settings. */
  applySettings(settings: SubtitleSettings): void {
    const style = this.root.style
    style.setProperty('--sub-size', String(settings.fontSize))
    style.setProperty('--sub-bottom', String(settings.bottom))
    style.setProperty('--sub-opacity', String(settings.opacity))
    this.root.classList.toggle('sub-outline', settings.outline)
    // `visibility`, not `display`: hidden lines stay laid out, so switching
    // subtitles back on is a repaint and nothing more.
    style.visibility = settings.visible ? '' : 'hidden'
  }

  /** Move the rows clear of the bottom controls and the top bar while they show. */
  setLifted(lifted: boolean): void {
    this.root.classList.toggle('sub-lifted', lifted)
  }

  /**
   * How far the bottom row must sit above the stage's bottom edge to clear the
   * control bar, in px. The bar's own height is fixed while the stage is not,
   * so the caller measures it rather than relying on a percentage.
   */
  setControlBarHeight(height: number): void {
    // The caller re-measures on every commit, so drop the no-op writes.
    if (height === this.barHeight) return
    this.barHeight = height
    this.root.style.setProperty('--sub-bar', `${height}px`)
  }

  /** The source's dimensions, for placing `\pos` signs on the picture. */
  setVideoSize(width: number, height: number): void {
    if (!(width > 0 && height > 0)) return
    this.root.style.setProperty('--sub-ar', String(width / height))
  }

  destroy(): void {
    this.signature = ''
    this.root.remove()
  }

  private line(cue: SubtitleCue): HTMLDivElement {
    const node = div('sub-line')
    const column = columnOf(cue.align ?? 2)
    if (column !== 'center') node.dataset.h = column
    this.decorate(node, cue)
    return node
  }

  private sign(cue: SubtitleCue): HTMLDivElement {
    const node = div('sub-line sub-sign')
    const align = cue.align ?? 2
    const pos = cue.pos ?? { x: 0.5, y: 0.5 }
    const column = columnOf(align)
    const row = rowOf(align)
    node.style.left = `${pos.x * 100}%`
    node.style.top = `${pos.y * 100}%`
    // `\pos` anchors the corner (or edge midpoint) its alignment names.
    const tx = column === 'left' ? '0' : column === 'right' ? '-100%' : '-50%'
    const ty = row === 'top' ? '0' : row === 'bottom' ? '-100%' : '-50%'
    node.style.transform = `translate(${tx}, ${ty})`
    if (column !== 'center') node.dataset.h = column
    this.decorate(node, cue)
    return node
  }

  private decorate(node: HTMLDivElement, cue: SubtitleCue): void {
    if (cue.scale !== undefined && cue.scale !== 1) {
      node.style.fontSize = `${cue.scale}em`
    }
    if (cue.italic) node.style.fontStyle = 'italic'
    // textContent, never innerHTML: subtitle files are untrusted input.
    node.textContent = cue.text
  }
}

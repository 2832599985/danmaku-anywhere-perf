import type { ILogger } from '@/common/Logger'

type PerfMeta = Record<string, unknown>

export class PerfTimer {
  private marks: { label: string; time: number }[] = []

  constructor(
    private logger: ILogger,
    private prefix: string,
    private enabled = false
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) {
      this.marks = []
    }
  }

  mark(label: string) {
    if (!this.enabled) return
    this.marks.push({ label, time: performance.now() })
  }

  measure(label: string, durationMs: number, meta?: PerfMeta) {
    if (!this.enabled) return
    const suffix = Number.isFinite(durationMs)
      ? `${durationMs.toFixed(2)}ms`
      : `${durationMs}ms`
    this.logger.debug(`[perf] ${this.prefix} ${label} ${suffix}`, meta ?? {})
  }

  summary(title = 'summary') {
    if (!this.enabled) return
    if (this.marks.length === 0) return

    const first = this.marks[0].time
    const summary = this.marks.map((mark, index) => {
      const prev = index === 0 ? mark.time : this.marks[index - 1].time
      return {
        label: mark.label,
        deltaMs: mark.time - prev,
        totalMs: mark.time - first,
      }
    })

    this.logger.debug(`[perf] ${this.prefix} ${title}`, summary)
    this.marks = []
  }
}

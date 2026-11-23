import type { Dimensions, EnhancementEffect } from '../types'

const factorOf = (e: EnhancementEffect) => e.upscaleFactor ?? 1

/**
 * Anime4K's built-in chains are fixed multiples: A/B/C reach 4x (two 2x
 * upscalers) and the doubled modes reach 8x (three). That only fits a target
 * that is exactly 4x/8x the source. A 1080p file on a 2560x1440 display asks
 * for 1.33x, and the renderer used to run every upscaler regardless, inserting
 * a Downscale between them. Two things went wrong:
 *
 *  1. The intermediate landed *below the source resolution*
 *     (3840x2160 -> 1280x720 for 1080p input), so the file's own detail was
 *     thrown away and a blurred image was upscaled back up.
 *  2. Work was wasted. 720p -> 1440p with A/balanced ran
 *     `CNNx2VL (720p->1440p)` then `Downscale (1440p->720p)` then
 *     `CNNx2M (720p->1440p)` — literally upscale, undo it, upscale again.
 *
 * This keeps only the upscalers the target actually needs. Overshoot is
 * harmless: the presentation pass already samples the final texture into the
 * canvas with a bilinear sampler, so it finishes the resize for free.
 *
 * Measured on a 1080p source / 2560x1440 target (A/balanced): 5 passes and
 * 32.5 MP become 3 passes and 18.7 MP, and the last texture is a clean
 * 3840x2160 instead of a 1280x720 that had to be re-upscaled.
 */
export function pruneRedundantUpscalers(
  effects: EnhancementEffect[],
  source: Dimensions,
  target: Dimensions
): EnhancementEffect[] {
  const upscalerIndices: number[] = []
  for (let i = 0; i < effects.length; i++) {
    if (factorOf(effects[i]) > 1) upscalerIndices.push(i)
  }
  if (upscalerIndices.length === 0) return effects

  const required = Math.max(
    target.width / Math.max(1, source.width),
    target.height / Math.max(1, source.height)
  )
  if (!Number.isFinite(required) || required <= 0) return effects

  // Fewest 2x (or 3x/4x) steps whose product reaches the target. A target
  // smaller than the source needs none — the presentation pass downsamples.
  let product = 1
  let keep = 0
  for (const index of upscalerIndices) {
    if (product >= required) break
    product *= factorOf(effects[index])
    keep++
  }

  // Drop everything after the last kept upscaler. Templates put each unit's
  // restore before its upscaler, so nothing meaningful is stranded in the tail.
  const lastKept = keep > 0 ? upscalerIndices[keep - 1] : upscalerIndices[0] - 1
  if (lastKept < 0) return []
  // Nothing to prune: hand back the caller's array so the no-op case cannot
  // churn the pipeline cache with an equal-but-distinct chain.
  if (lastKept === effects.length - 1) return effects
  return effects.slice(0, lastKept + 1)
}

/**
 * The factor the pruned chain still enlarges by, used to decide whether the
 * renderer's intermediate Downscale is worth inserting at all.
 */
export function chainUpscaleFactor(effects: EnhancementEffect[]): number {
  return effects.reduce((acc, e) => acc * factorOf(e), 1)
}

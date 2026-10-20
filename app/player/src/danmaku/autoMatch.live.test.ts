import { describe, it } from 'vitest'
import { aiExtractTitle } from './ai'
import { autoMatch } from './autoMatch'
import {
  fetchSeasonEpisodes,
  searchEpisodesByNumber,
  searchSeasons,
} from './ddp'

/**
 * Opt-in live audit against the real DanDanPlay + AI endpoints.
 *
 *   LIVE_AUTO_MATCH=1 corepack pnpm -C app/player exec vitest run \
 *     src/danmaku/autoMatch.live.test.ts
 *
 * Not part of the normal suite: it needs the network and the endpoints are
 * third-party. The corpus is deliberately layered (romaji/CJK, season markers,
 * absolute sequel numbering, movies, group-tag-only names) so the report shows
 * WHERE the pipeline fails, not just a pass count.
 */
const CORPUS = [
  '[LoliHouse] Futsutsuka na Akujo dewa Gozaimasu ga - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv',
  '[Nekomoe kissaten] Kusuriya no Hitorigoto - 12 [1080p].mkv',
  '[Airota][Sousou no Frieren][07][1080p][CHS].mkv',
  '【幻樱字幕组】★10月新番【咒术回战 第二季】【第11话】.mkv',
  '关于我转生变成史莱姆这档事 第三季 第05话.mp4',
  '[LoliHouse] 葬送的芙莉莲 - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv',
  '[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][1080p].mkv',
  '[Nekomoe kissaten] 药屋少女的呢喃 第二季 - 12 [1080p].mkv',
  '[Nekomoe kissaten] Kusuriya no Hitorigoto 第12话 華瑞月 [1080p].mkv',
  '[Lilith-Raws] One Piece - 1080 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4].mp4',
  '[Group] 葬送的芙莉莲 剧场版 [2024] [BDRip 1080p].mkv',
]

const env = (
  globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env

describe.skipIf(env?.LIVE_AUTO_MATCH !== '1')('live auto-match', () => {
  it('audits the release corpus against the real endpoints', {
    timeout: 600000,
  }, async () => {
    const lines: string[] = []
    let matched = 0
    let ambiguous = 0
    let notFound = 0
    let matchedNoAi = 0

    for (const name of CORPUS) {
      const info = await aiExtractTitle(name)
      const deps = {
        search: searchSeasons,
        episodes: fetchSeasonEpisodes,
        searchEpisodes: searchEpisodesByNumber,
      }
      const outcome = await autoMatch(name, info, deps)
      // The AI is an enhancer: the same file must still resolve when the
      // endpoint is down (the `[LoliHouse]` 500 path).
      const noAi = await autoMatch(name, null, deps)
      if (outcome.status === 'matched') matched += 1
      else if (outcome.status === 'ambiguous') ambiguous += 1
      else notFound += 1
      if (noAi.status === 'matched') matchedNoAi += 1

      lines.push(
        JSON.stringify({
          name,
          ai: info ? `${info.title} / ep ${info.episode}` : 'unavailable',
          status: outcome.status,
          noAi: noAi.status,
          ...(outcome.status === 'matched'
            ? {
                season: outcome.season.title,
                episode: outcome.episode.episodeNumber,
                episodeMode: outcome.episodeMode,
                matchMode: outcome.matchMode,
                keyword: outcome.keyword,
              }
            : outcome.status === 'ambiguous'
              ? {
                  reason: outcome.reason,
                  target: outcome.targetEpisode,
                  top: outcome.attempts.seasons.slice(0, 3).map((s) => ({
                    title: s.title,
                    score: s.score,
                    episode: s.episode,
                  })),
                }
              : { reason: outcome.reason }),
          attempts: outcome.attempts.seasons.slice(0, 3),
        })
      )
    }

    console.error(
      `\nLIVE_AUDIT ${JSON.stringify({
        corpus: CORPUS.length,
        matched,
        matchedNoAi,
        ambiguous,
        notFound,
      })}\n${lines.join('\n')}\n`
    )
  })
})

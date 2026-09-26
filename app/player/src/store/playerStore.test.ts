import { beforeEach, describe, expect, it } from 'vitest'
import { type PlaylistItem, usePlayerStore } from './playerStore'

const DIR = 'C:\\Users\\x\\Videos'
const ep = (n: number): PlaylistItem => {
  const name = `无用圣女的异世界美食之旅 凭借隐藏技能召唤露营车 第 ${n} 集：第0${n}集 · 稀饭动漫 Next.mp4`
  const path = `${DIR}\\${name}`
  return { url: `stream://${path}`, name, path }
}
const other = (name: string): PlaylistItem => {
  const path = `${DIR}\\${name}.mp4`
  return { url: `stream://${path}`, name: `${name}.mp4`, path }
}
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ep(from + i))

const store = () => usePlayerStore.getState()
/** Episode numbers (or names) of the playlist, in order. */
const order = () =>
  store().playlist.map(
    (item) => /第 (\d+) 集/.exec(item.name)?.[1] ?? item.name
  )
/** What autoplay plays when the current entry ends. */
const next = () => store().playlist[store().playlistIndex + 1]

beforeEach(() => {
  store().clearPlaylist()
})

describe('placeAroundCurrent', () => {
  it('opening episode 7 continues into episode 8, not episode 1', () => {
    // Regression: everything used to be queued BEHIND the current file
    // (`7,1,2,…,6,8,9`), so autoplay jumped from episode 7 back to 1.
    store().openMedia([ep(7)])
    store().placeAroundCurrent(range(1, 6), range(8, 9))
    expect(order()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(store().media?.path).toBe(ep(7).path)
    expect(store().playlist[store().playlistIndex].path).toBe(ep(7).path)
    expect(next()?.path).toBe(ep(8).path)
  })

  it('re-anchors a batch that is already queued, without duplicates', () => {
    store().openMedia([ep(1)])
    store().placeAroundCurrent([], range(2, 9))
    // Pick episode 3 from the list, as the user would; the scan runs again.
    store().playPlaylistIndex(2)
    store().placeAroundCurrent(range(1, 2), range(4, 9))
    expect(order()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(next()?.path).toBe(ep(4).path)
  })

  it('leaves unrelated history where it was', () => {
    store().openMedia([other('A')])
    store().openMedia([other('B')])
    store().openMedia([ep(7)])
    store().placeAroundCurrent(range(5, 6), range(8, 8))
    expect(order()).toEqual(['A.mp4', 'B.mp4', '5', '6', '7', '8'])
    expect(next()?.path).toBe(ep(8).path)
  })

  it('never lists the playing entry twice, even if a caller passes it', () => {
    store().openMedia([ep(7)])
    store().placeAroundCurrent([ep(6), ep(7)], [ep(7), ep(8), ep(6)])
    expect(order()).toEqual(['6', '7', '8'])
    expect(store().playlist[store().playlistIndex].path).toBe(ep(7).path)
  })

  it('does nothing when nothing is playing', () => {
    store().placeAroundCurrent(range(1, 2), range(3, 4))
    expect(store().playlist).toEqual([])
  })
})

describe('setSubtitles', () => {
  it('drops the embedded-track highlight when another subtitle replaces it', () => {
    store().openMedia([ep(7)])
    store().setActiveEmbeddedTrack(2)
    store().setSubtitles([{ start: 0, end: 1, text: 'x' }], {
      label: 'x.srt',
      count: 1,
      kind: 'file',
    })
    expect(store().activeEmbeddedTrack).toBeNull()
  })
})

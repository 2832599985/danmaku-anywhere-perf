export const PATTERNS = {
  // season patterns intentionally captures the whole string rather than the numeric part
  // this is because season is used in the search key, so it should be the same as the original title
  SEASON: [
    /(?:^|\s|[\[(])(S\d+)(?:$|\s|[\])])/i, // S1
    /(?:^|\s)(Season\s*\d+)(?:$|\s)/i, // Season 1
    /(?:^|\s)(\d+(?:st|nd|rd|th)\s*Season)(?:$|\s)/i, // 2nd Season
    /(?:^|\s)(Part\s*\d+)(?:$|\s)/i, // Part 2
    /(第\s*(?:\d+|[零一二三四五六七八九十百]+)\s*[季期部])/, // Chinese
  ],
  EPISODE: [
    /(?:^|\s|[\[(])E(\d+)(?:$|\s|[\])])/i, // E1
    /(?:^|\s)Ep(?:isode)?\.?\s+(\d+)(?:$|\s)/i, // Episode 1
    /第\s*(\d+|[零一二三四五六七八九十百]+)\s*[集话]/, // Chinese
    /(?<=S\d+)E(\d+)/i, // S_E_, but only matches the E part
    // "Show - 11" / "Show - 11v2" (LoliHouse, Nekomoe, most fansub releases).
    // Years are excluded so "- 2024" stays a year, not an episode.
    /(?:^|[\s._])-\s*((?!(?:19|20)\d{2}\b)\d{1,4})(?:v\d+)?(?=\s|\[|\(|$)/,
    // "[11]" — a pure-number bracket. Resolution brackets ([1080p]) and years
    // are not pure numbers or are excluded; [1080] alone is treated as a
    // resolution, not an episode.
    /\[((?!(?:19|20)\d{2}\b)(?!(?:480|576|720|1080|2160|4320)\])\d{1,4})(?:v\d+)?\]/,
  ],
}

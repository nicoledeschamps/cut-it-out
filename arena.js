const CHANNELS = ['i-like-t58kvbzcjmu', 'creative-direction-msvjvkzq6ei'];
const PER_PAGE = 30;

function pickUrl(block) {
  return block?.image?.large?.url || block?.image?.original?.url || block?.image?.display?.url || null;
}

function pickThumb(block) {
  return block?.image?.thumb?.url || block?.image?.square?.url || block?.image?.display?.url || pickUrl(block);
}

async function fetchPage(slug, page = 1) {
  const url = `https://api.are.na/v2/channels/${slug}/contents?per=${PER_PAGE}&page=${page}&direction=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Are.na fetch failed: ' + res.status);
  return res.json();
}

export async function fetchArenaImages(page = 1) {
  const results = await Promise.all(CHANNELS.map(slug => fetchPage(slug, page)));
  const all = [];
  for (const r of results) {
    for (const block of r.contents || []) {
      const full = pickUrl(block);
      const thumb = pickThumb(block);
      if (!full) continue;
      // skip Pinterest/IG source URLs (matches HoS filter pattern)
      const src = block.source?.url || '';
      if (/pinterest|instagram/i.test(src)) continue;
      all.push({
        id: `arena-${block.id}`,
        full,
        thumb,
        title: block.title || '',
        source: 'arena',
      });
    }
  }
  // dedupe by full URL
  const seen = new Set();
  return all.filter(i => {
    if (seen.has(i.full)) return false;
    seen.add(i.full);
    return true;
  });
}

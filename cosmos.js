const PER_PAGE = 30;
let cache = null;

async function loadAll() {
  if (cache) return cache;
  const res = await fetch('./cosmos-data.json');
  if (!res.ok) throw new Error('cosmos-data.json fetch failed: ' + res.status);
  const data = await res.json();
  cache = (data.images || [])
    .filter(i => i.src)
    .map((i, idx) => ({
      id: `cosmos-${idx}`,
      full: rewriteWidth(i.src, 1200),
      thumb: rewriteWidth(i.src, 200),
      title: i.collection || '',
      source: 'cosmos',
    }));
  return cache;
}

function rewriteWidth(url, w) {
  return url.replace(/([?&])w=\d+/, `$1w=${w}`);
}

export async function fetchCosmosImages(page = 1) {
  const all = await loadAll();
  const start = (page - 1) * PER_PAGE;
  return all.slice(start, start + PER_PAGE);
}

export async function cosmosTotal() {
  const all = await loadAll();
  return all.length;
}

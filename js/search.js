// Film search. Uses TMDB when a key is configured, otherwise two keyless
// sources merged together: iTunes (posters) + Wikidata (deep catalogue).

const cfg = () => window.MOVIE_NIGHT_CONFIG || {};

function withTimeout(promise, ms = 7000) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

let jsonpN = 0;
function jsonp(url, ms = 7000) {
  return new Promise((resolve, reject) => {
    const name = '__mn_jsonp_' + (++jsonpN);
    const s = document.createElement('script');
    const done = () => { delete window[name]; s.remove(); clearTimeout(t); };
    const t = setTimeout(() => { done(); reject(new Error('timeout')); }, ms);
    window[name] = data => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error('jsonp failed')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + name;
    document.head.appendChild(s);
  });
}

async function tmdb(q) {
  const url = 'https://api.themoviedb.org/3/search/movie?include_adult=false&language=en-US&api_key='
    + encodeURIComponent(cfg().TMDB_API_KEY) + '&query=' + encodeURIComponent(q);
  const r = await withTimeout(fetch(url)); if (!r.ok) throw new Error('tmdb ' + r.status);
  const data = await r.json();
  return (data.results || []).slice(0, 10).map(m => ({
    title: m.title,
    original: m.original_title !== m.title ? m.original_title : null,
    year: m.release_date ? +m.release_date.slice(0, 4) : null,
    poster: m.poster_path ? 'https://image.tmdb.org/t/p/w342' + m.poster_path : null,
    ext_id: 'tmdb:' + m.id,
    blurb: m.overview ? m.overview.slice(0, 110) + (m.overview.length > 110 ? '…' : '') : null,
  }));
}

async function itunes(q) {
  const data = await jsonp('https://itunes.apple.com/search?media=movie&entity=movie&limit=10&term=' + encodeURIComponent(q));
  return (data.results || []).map(m => ({
    title: m.trackName,
    year: m.releaseDate ? +m.releaseDate.slice(0, 4) : null,
    poster: m.artworkUrl100 ? m.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x450bb.') : null,
    ext_id: 'itunes:' + m.trackId,
    blurb: m.primaryGenreName ? m.primaryGenreName.toLowerCase() + (m.artistName ? ' · ' + m.artistName.toLowerCase() : '') : null,
  }));
}

async function wikidata(q) {
  const url = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=en&uselang=en&type=item&limit=20&search='
    + encodeURIComponent(q);
  const r = await withTimeout(fetch(url)); if (!r.ok) throw new Error('wikidata ' + r.status);
  const data = await r.json();
  return (data.search || [])
    .filter(x => /\bfilm\b/i.test(x.description || '') && !/(film (director|producer|editor|critic|festival|series|award|studio|company)|filmmaker|actor|actress)/i.test(x.description || ''))
    .map(x => {
      const y = (x.description || '').match(/\b(18|19|20)\d{2}\b/);
      return { title: x.label, year: y ? +y[0] : null, poster: null, ext_id: 'wd:' + x.id, blurb: x.description };
    });
}

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export async function searchFilms(q) {
  q = q.trim(); if (q.length < 2) return [];
  if (cfg().TMDB_API_KEY) {
    try { return await tmdb(q); } catch (e) { console.warn(e); }
  }
  const [a, b] = await Promise.allSettled([itunes(q), wikidata(q)]);
  const out = []; const seen = new Set();
  const add = m => {
    const k = norm(m.title) + '|' + (m.year || '');
    if (!m.title || seen.has(k)) return;
    // a wikidata hit without year duplicates an itunes hit with the same title
    if (!m.year && out.some(o => norm(o.title) === norm(m.title))) return;
    seen.add(k); out.push(m);
  };
  // itunes first when it matches well (it has posters), then the deeper wikidata list
  const it = a.status === 'fulfilled' ? a.value : [];
  const wd = b.status === 'fulfilled' ? b.value : [];
  it.forEach(add); wd.forEach(add);
  if (a.status === 'rejected' && b.status === 'rejected') throw new Error('search unavailable');
  // titles that start with the query first
  const nq = norm(q);
  return out.map((m, i) => ({ m, i, s: norm(m.title) === nq ? 0 : norm(m.title).startsWith(nq) ? 1 : 2 }))
    .sort((x, y) => x.s - y.s || x.i - y.i).map(x => x.m).slice(0, 8);
}

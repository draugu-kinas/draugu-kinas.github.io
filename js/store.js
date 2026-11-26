// Data layer. Two implementations with the same shape:
//   SupabaseStore — the real shared board
//   DemoStore     — everything in this browser's localStorage (preview / no config)

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function randomToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
export function deviceToken() {
  let t = LS.get('mn.token');
  if (!t) { t = randomToken(); LS.set('mn.token', t); }
  return t;
}
export const lastNickname = {
  get: () => LS.get('mn.nick', ''),
  set: v => LS.set('mn.nick', v),
};
export const hostKeyStore = {
  get: () => LS.get('mn.hostkey', ''),
  set: v => LS.set('mn.hostkey', v),
  clear: () => LS.del('mn.hostkey'),
};

export const LIMITS = { movies: 3, votes: 5 };

export const ERRORS = {
  limit_movies: 'you already put 3 films in the pool. remove one to add another.',
  limit_votes: 'all 5 of your tickets are spent. take one back to move it.',
  duplicate: 'that film is already in the pool. give it a ticket instead!',
  not_open: 'voting is closed for this night.',
  not_joined: 'tell us your nickname first.',
  not_yours: 'only the person who suggested it can remove it.',
  date_locked: 'the host already picked the date.',
  past_date: 'that day has already happened.',
  too_many_dates: 'enough dates on the table — tick the ones that work.',
  bad_host_key: 'that host key is not right.',
  key_too_short: 'pick a key with at least 6 characters.',
  nickname_required: 'a nickname, please.',
  event_full: 'the room is full.',
};
export function friendlyError(e) {
  const msg = String(e?.message || e || '');
  for (const code of Object.keys(ERRORS)) if (msg.includes(code)) return ERRORS[code];
  console.error(e);
  return 'something went wrong. try again in a moment.';
}

/* ------------------------------------------------------------------ */
/*  Supabase                                                           */
/* ------------------------------------------------------------------ */

export class SupabaseStore {
  constructor(url, key) { this.url = url; this.key = key; this.demo = false; }

  async init() {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    this.sb = createClient(this.url, this.key, { auth: { persistSession: false } });
  }

  async rpc(name, args) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async q(p) { const { data, error } = await p; if (error) throw error; return data; }

  meFor(eventId) { return LS.get('mn.me.' + eventId); }

  async load() {
    const events = await this.q(this.sb.from('events').select('*')
      .neq('status', 'archived').order('number', { ascending: false }).limit(1));
    const event = events[0];
    if (!event) return { event: null };
    const [participants, movies, votes, dateOptions] = await Promise.all([
      this.q(this.sb.from('participants').select('id,nickname,bringing,created_at').eq('event_id', event.id).order('created_at')),
      this.q(this.sb.from('movies').select('*').eq('event_id', event.id).order('created_at')),
      this.q(this.sb.from('votes').select('movie_id,participant_id').eq('event_id', event.id)),
      this.q(this.sb.from('date_options').select('*').eq('event_id', event.id).order('day')),
    ]);
    const dateVotes = dateOptions.length
      ? await this.q(this.sb.from('date_votes').select('*').in('date_option_id', dateOptions.map(d => d.id)))
      : [];
    let me = this.meFor(event.id);
    if (me && !participants.some(p => p.id === me)) me = null;
    return { event, participants, movies, votes, dateOptions, dateVotes, me };
  }

  async archive() {
    const events = await this.q(this.sb.from('events').select('*')
      .eq('status', 'archived').order('number', { ascending: false }));
    if (!events.length) return [];
    const ids = events.map(e => e.id);
    const [movies, participants] = await Promise.all([
      this.q(this.sb.from('movies').select('id,event_id,participant_id,title,year,poster,note,votes(count)').in('event_id', ids)),
      this.q(this.sb.from('participants').select('id,event_id,nickname').in('event_id', ids)),
    ]);
    return events.map(e => ({
      ...e,
      participants: participants.filter(p => p.event_id === e.id),
      movies: movies.filter(m => m.event_id === e.id)
        .map(m => ({ ...m, tickets: m.votes?.[0]?.count ?? 0 }))
        .sort((a, b) => b.tickets - a.tickets),
    }));
  }

  async join(eventId, nickname, bringing) {
    const id = await this.rpc('join_event', { p_event: eventId, p_token: deviceToken(), p_nickname: nickname, p_bringing: bringing || null });
    LS.set('mn.me.' + eventId, id);
    return id;
  }
  addMovie(eventId, m) {
    return this.rpc('add_movie', { p_event: eventId, p_token: deviceToken(), p_title: m.title, p_year: m.year || null,
      p_poster: m.poster || null, p_ext_id: m.ext_id || null, p_note: m.note || null });
  }
  removeMovie(movieId) { return this.rpc('remove_movie', { p_token: deviceToken(), p_movie: movieId }); }
  toggleVote(movieId) { return this.rpc('toggle_vote', { p_token: deviceToken(), p_movie: movieId }); }
  proposeDate(eventId, day) { return this.rpc('propose_date', { p_event: eventId, p_token: deviceToken(), p_day: day }); }
  toggleDate(optionId) { return this.rpc('toggle_date', { p_token: deviceToken(), p_option: optionId }); }

  hostHasKey() { return this.rpc('host_has_key', {}); }
  hostClaim(key) { return this.rpc('host_claim', { p_key: key }); }
  hostUpdate(key, eventId, patch) { return this.rpc('host_update_event', { p_key: key, p_event: eventId, p_patch: patch }); }
  hostRemoveMovie(key, movieId) { return this.rpc('host_remove_movie', { p_key: key, p_movie: movieId }); }
  hostArchiveAndNew(key, eventId) { return this.rpc('host_archive_and_new', { p_key: key, p_event: eventId }); }

  subscribe(cb) {
    let t;
    const ping = () => { clearTimeout(t); t = setTimeout(cb, 250); };
    const ch = this.sb.channel('movie-night')
      .on('postgres_changes', { event: '*', schema: 'public' }, ping)
      .subscribe();
    const poll = setInterval(ping, 30000);
    const vis = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', vis);
    return () => { this.sb.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', vis); };
  }
}

/* ------------------------------------------------------------------ */
/*  Demo (localStorage) — mirrors the database rules                   */
/* ------------------------------------------------------------------ */

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : randomToken());
const DB_KEY = 'mn.demo.db.v1';

function isoDay(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const ev = { id: uid(), number: 1, title: 'movie night no. 1',
    tagline: 'films that widen the world a little, watched by people who make it warmer.',
    theme: 'moss', location: 'upper room, life church', bring: 'snacks & a blanket',
    final_date: null, final_time: null, status: 'open', winner_movie_id: null, created_at: new Date().toISOString() };
  const p = (nickname, bringing) => ({ id: uid(), event_id: ev.id, nickname, bringing, created_at: new Date().toISOString() });
  const ps = [p('ruta', 'popcorn'), p('the professor', 'a blanket'), p('mantas', 'tea')];
  const m = (pi, title, year, note) => ({ id: uid(), event_id: ev.id, participant_id: ps[pi].id, title, year, poster: null, ext_id: null, note, created_at: new Date().toISOString() });
  const ms = [
    m(0, 'Paterson', 2016, 'a bus driver writes poems. that is the whole film and it is perfect.'),
    m(1, 'Stalker', 1979, 'long, slow, and you will think about it for a week.'),
    m(2, 'Columbus', 2017, null),
    m(0, 'Tampopo', 1985, 'a ramen western. bring noodles.'),
  ];
  const votes = [
    [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 3],
  ].map(([pi, mi]) => ({ movie_id: ms[mi].id, participant_id: ps[pi].id, event_id: ev.id }));
  const d1 = { id: uid(), event_id: ev.id, day: isoDay(9), proposed_by: ps[0].id };
  const d2 = { id: uid(), event_id: ev.id, day: isoDay(16), proposed_by: ps[1].id };
  const dateVotes = [
    { date_option_id: d1.id, participant_id: ps[0].id }, { date_option_id: d1.id, participant_id: ps[2].id },
    { date_option_id: d2.id, participant_id: ps[1].id },
  ];
  const past = { id: uid(), number: 0, title: 'the pilot episode', tagline: null, theme: 'pink', location: 'upper room, life church',
    bring: null, final_date: isoDay(-30), final_time: '19:00', status: 'archived', winner_movie_id: null,
    created_at: new Date().toISOString(), archived_at: new Date().toISOString() };
  const pastP = { id: uid(), event_id: past.id, nickname: 'ruta', bringing: null };
  const pastM = { id: uid(), event_id: past.id, participant_id: pastP.id, title: 'The Grand Budapest Hotel', year: 2014, poster: null, note: 'obviously.' };
  const pastM2 = { id: uid(), event_id: past.id, participant_id: pastP.id, title: 'Amélie', year: 2001, poster: null, note: null };
  past.winner_movie_id = pastM.id;
  return {
    events: [past, ev], participants: [...ps, pastP], movies: [...ms, pastM, pastM2],
    votes: [...votes, { movie_id: pastM.id, participant_id: pastP.id, event_id: past.id }],
    dateOptions: [d1, d2], dateVotes, hostKey: null, secrets: {},
  };
}

export class DemoStore {
  constructor() { this.demo = true; this.listeners = new Set(); }
  async init() { if (!LS.get(DB_KEY)) LS.set(DB_KEY, seed()); }
  get db() { return LS.get(DB_KEY) || seed(); }
  save(db) { LS.set(DB_KEY, db); setTimeout(() => this.listeners.forEach(f => f()), 0); }
  reset() { LS.set(DB_KEY, seed()); Object.keys(localStorage).filter(k => k.startsWith('mn.me.')).forEach(k => LS.del(k)); }
  fail(code) { throw new Error(code); }
  current(db) { return db.events.filter(e => e.status !== 'archived').sort((a, b) => b.number - a.number)[0]; }
  me(db, eventId) {
    const id = db.secrets[eventId + ':' + deviceToken()];
    if (!id) this.fail('not_joined');
    return id;
  }
  open(db, eventId) { if (!db.events.some(e => e.id === eventId && e.status === 'open')) this.fail('not_open'); }

  async load() {
    const db = this.db; const event = this.current(db);
    if (!event) return { event: null };
    const dateOptions = db.dateOptions.filter(d => d.event_id === event.id).sort((a, b) => a.day.localeCompare(b.day));
    return {
      event,
      participants: db.participants.filter(p => p.event_id === event.id),
      movies: db.movies.filter(m => m.event_id === event.id),
      votes: db.votes.filter(v => v.event_id === event.id),
      dateOptions,
      dateVotes: db.dateVotes.filter(v => dateOptions.some(d => d.id === v.date_option_id)),
      me: db.secrets[event.id + ':' + deviceToken()] || null,
    };
  }
  async archive() {
    const db = this.db;
    return db.events.filter(e => e.status === 'archived').sort((a, b) => b.number - a.number).map(e => ({
      ...e,
      participants: db.participants.filter(p => p.event_id === e.id),
      movies: db.movies.filter(m => m.event_id === e.id)
        .map(m => ({ ...m, tickets: db.votes.filter(v => v.movie_id === m.id).length }))
        .sort((a, b) => b.tickets - a.tickets),
    }));
  }
  async join(eventId, nickname, bringing) {
    const db = this.db; nickname = nickname.trim();
    if (!nickname) this.fail('nickname_required');
    const k = eventId + ':' + deviceToken();
    let id = db.secrets[k];
    if (id) Object.assign(db.participants.find(p => p.id === id), { nickname, bringing: bringing || null });
    else { id = uid(); db.participants.push({ id, event_id: eventId, nickname, bringing: bringing || null, created_at: new Date().toISOString() }); db.secrets[k] = id; }
    this.save(db); return id;
  }
  async addMovie(eventId, m) {
    const db = this.db; this.open(db, eventId); const me = this.me(db, eventId);
    const evMovies = db.movies.filter(x => x.event_id === eventId);
    if (evMovies.filter(x => x.participant_id === me).length >= LIMITS.movies) this.fail('limit_movies');
    if (evMovies.some(x => x.title.toLowerCase() === m.title.trim().toLowerCase() && (x.year || 0) === (m.year || 0))) this.fail('duplicate');
    const id = uid();
    db.movies.push({ id, event_id: eventId, participant_id: me, title: m.title.trim(), year: m.year || null,
      poster: m.poster || null, ext_id: m.ext_id || null, note: m.note || null, created_at: new Date().toISOString() });
    this.save(db); return id;
  }
  async removeMovie(movieId) {
    const db = this.db; const m = db.movies.find(x => x.id === movieId); if (!m) return;
    this.open(db, m.event_id);
    if (m.participant_id !== this.me(db, m.event_id)) this.fail('not_yours');
    db.movies = db.movies.filter(x => x.id !== movieId); db.votes = db.votes.filter(v => v.movie_id !== movieId);
    this.save(db);
  }
  async toggleVote(movieId) {
    const db = this.db; const m = db.movies.find(x => x.id === movieId);
    this.open(db, m.event_id); const me = this.me(db, m.event_id);
    const i = db.votes.findIndex(v => v.movie_id === movieId && v.participant_id === me);
    if (i >= 0) { db.votes.splice(i, 1); this.save(db); return false; }
    if (db.votes.filter(v => v.event_id === m.event_id && v.participant_id === me).length >= LIMITS.votes) this.fail('limit_votes');
    db.votes.push({ movie_id: movieId, participant_id: me, event_id: m.event_id }); this.save(db); return true;
  }
  async proposeDate(eventId, day) {
    const db = this.db; const ev = db.events.find(e => e.id === eventId);
    if (ev.final_date) this.fail('date_locked');
    const me = this.me(db, eventId);
    if (day < isoDay(0)) this.fail('past_date');
    let o = db.dateOptions.find(d => d.event_id === eventId && d.day === day);
    if (!o) { o = { id: uid(), event_id: eventId, day, proposed_by: me }; db.dateOptions.push(o); }
    if (!db.dateVotes.some(v => v.date_option_id === o.id && v.participant_id === me)) db.dateVotes.push({ date_option_id: o.id, participant_id: me });
    this.save(db); return o.id;
  }
  async toggleDate(optionId) {
    const db = this.db; const o = db.dateOptions.find(d => d.id === optionId);
    const ev = db.events.find(e => e.id === o.event_id);
    if (ev.final_date) this.fail('date_locked');
    const me = this.me(db, o.event_id);
    const i = db.dateVotes.findIndex(v => v.date_option_id === optionId && v.participant_id === me);
    if (i >= 0) {
      db.dateVotes.splice(i, 1);
      if (!db.dateVotes.some(v => v.date_option_id === optionId)) db.dateOptions = db.dateOptions.filter(d => d.id !== optionId);
      this.save(db); return false;
    }
    db.dateVotes.push({ date_option_id: optionId, participant_id: me }); this.save(db); return true;
  }
  host(db, key) { if (!db.hostKey || db.hostKey !== key) this.fail('bad_host_key'); }
  async hostHasKey() { return !!this.db.hostKey; }
  async hostClaim(key) {
    if ((key || '').length < 6) this.fail('key_too_short');
    const db = this.db; if (db.hostKey) return db.hostKey === key;
    db.hostKey = key; this.save(db); return true;
  }
  async hostUpdate(key, eventId, patch) {
    const db = this.db; this.host(db, key);
    const ev = db.events.find(e => e.id === eventId);
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'status' && !['open', 'locked'].includes(v)) continue;
      ev[k] = v === '' ? null : v;
    }
    this.save(db);
  }
  async hostRemoveMovie(key, movieId) {
    const db = this.db; this.host(db, key);
    db.movies = db.movies.filter(x => x.id !== movieId); db.votes = db.votes.filter(v => v.movie_id !== movieId);
    this.save(db);
  }
  async hostArchiveAndNew(key, eventId) {
    const db = this.db; this.host(db, key);
    const ev = db.events.find(e => e.id === eventId);
    if (!ev.winner_movie_id) {
      const ranked = db.movies.filter(m => m.event_id === eventId)
        .map(m => ({ m, n: db.votes.filter(v => v.movie_id === m.id).length }))
        .sort((a, b) => b.n - a.n);
      ev.winner_movie_id = ranked[0]?.m.id || null;
    }
    ev.status = 'archived'; ev.archived_at = new Date().toISOString();
    const next = { id: uid(), number: ev.number + 1, title: 'movie night no. ' + (ev.number + 1), tagline: null,
      theme: ev.theme, colors: ev.colors || null, room: ev.room || null, location: ev.location, bring: ev.bring, final_date: null, final_time: null,
      status: 'open', winner_movie_id: null, created_at: new Date().toISOString() };
    db.events.push(next); this.save(db); return next.id;
  }
  subscribe(cb) {
    this.listeners.add(cb);
    const onStorage = e => { if (e.key === DB_KEY) cb(); };
    window.addEventListener('storage', onStorage);
    return () => { this.listeners.delete(cb); window.removeEventListener('storage', onStorage); };
  }
}

export async function createStore() {
  const cfg = window.MOVIE_NIGHT_CONFIG || {};
  const store = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
    ? new SupabaseStore(cfg.SUPABASE_URL.trim(), cfg.SUPABASE_ANON_KEY.trim())
    : new DemoStore();
  await store.init();
  return store;
}

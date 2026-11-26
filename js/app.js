import { createStore, friendlyError, LIMITS, lastNickname, hostKeyStore } from './store.js';
import { searchFilms } from './search.js';
import { THEMES, COLOR_SLOTS, themeColors, applyTheme } from './themes.js';

/* ---------------- tiny DOM helper (always textContent, never innerHTML for data) ---------------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $app = document.getElementById('app');
const cfg = window.MOVIE_NIGHT_CONFIG || {};

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------- formatting ---------------- */
const fmtDay = (iso, opts = { weekday: 'short', day: 'numeric', month: 'long' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts).toLowerCase();
const localToday = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const hash = s =>[...(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
const posterColors = ['var(--accent)', 'var(--rug2)', 'var(--rug1)', 'var(--wood2)', 'var(--wall2)'];

function poster(m, cls = 'poster') {
  const typo = () => h('div', { class: cls + ' type', style: `background:${posterColors[Math.abs(hash(m.title)) % posterColors.length]}` },
    h('b', null, m.title), h('span', null, m.year || ''));
  if (!m.poster || !/^https:\/\//.test(m.poster)) return typo();
  const box = h('div', { class: cls });
  const img = h('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.onerror = () => box.replaceWith(typo());
  img.src = m.poster;
  box.append(img);
  return box;
}

const ticketIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 14'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M1 1h18v4a2 2 0 0 0 0 4v4H1V9a2 2 0 0 0 0-4z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p); return svg;
};

/* ---------------- state ---------------- */
let store, data = { event: null };
let cleanupRoute = () => {};
let pendingRender = false;
let arriving = false; // true right after zooming through the tv
let previewColors = null; // unsaved colours the host is trying out on the host page
const applyEventTheme = () => { if (data.event) applyTheme(data.event.theme, previewColors || data.event.colors); };

async function reload() {
  try { data = await store.load(); }
  catch (e) { console.error(e); toast('could not reach the board. check your connection.'); }
  applyEventTheme();
}

function route() { return (location.hash.replace(/^#\/?/, '') || 'room').split('?')[0]; }

async function render() {
  cleanupRoute(); cleanupRoute = () => {};
  const r = route();
  window.scrollTo({ top: 0 });
  if (r === 'board') renderBoard();
  else if (r === 'archive') renderArchive();
  else if (r === 'host') renderHost();
  else renderRoom();
  if (arriving) {
    arriving = false;
    // let the glow behind the page fade back to the wall colour
    requestAnimationFrame(() => { document.body.style.backgroundColor = ''; });
  }
}

function softRerender() {
  // don't wipe a form someone is typing in
  const a = document.activeElement;
  if (a && $app.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { pendingRender = true; return; }
  if (document.querySelector('.modal-back')) { pendingRender = true; return; }
  const y = window.scrollY;
  if (route() === 'board') { renderBoard(true); window.scrollTo({ top: y }); }
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) { pendingRender = false; softRerender(); } }, 50));

/* =====================================================================
   THE ROOM
   ===================================================================== */
const screenLines = [
  'tonight-ish · a small cinema for friends',
  '3 films each · 5 tickets each',
  'snacks encouraged · blankets essential',
  'films that widen the world a little',
];

function renderRoom() {
  const ev = data.event;
  const when = ev?.final_date ? fmtDay(ev.final_date) + (ev.final_time ? ', ' + ev.final_time : '') : 'date tbd';
  const text = h('div', { class: 'screen-text' });
  const buttons = h('div', { class: 'screen-buttons' },
    h('button', { class: 'primary', onclick: () => enter() }, 'yes'),
    h('button', { onclick: () => enter() }, 'obviously'));
  const sub = h('div', { class: 'screen-sub' }, screenLines[0]);
  const canvas = h('canvas', { width: 160, height: 120 });
  const screen = h('div', { class: 'screen tuning' }, canvas, h('div', { class: 'screen-content' }, text, buttons, sub));
  const knob1 = h('button', { class: 'knob', 'aria-label': 'change channel', onclick: () => channel() });
  const knob2 = h('button', { class: 'knob', 'aria-label': 'volume', onclick: e => e.currentTarget.classList.toggle('turned') });
  const room = h('section', { class: 'room', 'aria-label': 'a cosy room with a glowing television' },
    h('div', { class: 'wall' }),
    h('div', { class: 'molding' }),
    h('div', { class: 'plaque' }, cfg.CLUB_NAME || 'the picture club', h('small', null, ev ? 'night no. ' + ev.number : 'est. 2026')),
    h('div', { class: 'frame l', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('div', { class: 'frame r', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('div', { class: 'sconce l', 'aria-hidden': 'true' }, h('i', { class: 'glow' })),
    h('div', { class: 'sconce r', 'aria-hidden': 'true' }, h('i', { class: 'glow' })),
    h('div', { class: 'wainscot' }),
    h('div', { class: 'floor' }, h('div', { class: 'rug' })),
    h('div', { class: 'plant l', 'aria-hidden': 'true' }, h('i', { class: 'leaf' }), h('i', { class: 'leaf' }), h('i', { class: 'leaf' }), h('i', { class: 'leaf' }), h('i', { class: 'pot' })),
    h('div', { class: 'plant r', 'aria-hidden': 'true' }, h('i', { class: 'leaf' }), h('i', { class: 'leaf' }), h('i', { class: 'leaf' }), h('i', { class: 'leaf' }), h('i', { class: 'pot' })),
    h('div', { class: 'tv' },
      h('div', { class: 'antenna', 'aria-hidden': 'true' }, h('i'), h('i'), h('b')),
      h('div', { class: 'cabinet' },
        h('div', { class: 'bezel' }, screen),
        h('div', { class: 'panel' }, knob1, knob2, h('div', { class: 'grille' }), h('div', { class: 'brand' }, 'upper·vision'))),
      h('div', { class: 'legs', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      h('div', { class: 'tv-shadow' })),
    h('div', { class: 'spill', 'aria-hidden': 'true' }),
    h('div', { class: 'sofa', 'aria-hidden': 'true' },
      h('div', { class: 'back' }), h('div', { class: 'arm l' }), h('div', { class: 'arm r' }),
      h('div', { class: 'pillow l' }), h('div', { class: 'pillow r' }), h('div', { class: 'blanket' })),
    h('nav', { class: 'room-nav' }, h('a', { href: '#/archive' }, 'archive')),
    h('div', { class: 'caption' },
      h('span', null, ev?.title || 'movie night'),
      h('span', null, ev?.location || 'somewhere cosy'),
      h('span', null, when)),
    h('div', { class: 'flash' }));
  $app.replaceChildren(room);

  /* static noise */
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(160, 120);
  let raf, last = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const noise = t => {
    raf = requestAnimationFrame(noise);
    if (t - last < 70) return; last = t;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255 | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  };
  if (!reduce) raf = requestAnimationFrame(noise); else noise(0);

  /* type the question */
  const phrase = 'wanna watch a movie?';
  let i = 0, typeT;
  const caret = h('span', { class: 'caret' });
  const type = () => {
    text.replaceChildren(phrase.slice(0, i), caret);
    if (i++ < phrase.length) typeT = setTimeout(type, i < 2 ? 500 : 55 + Math.random() * 70);
    else typeT = setTimeout(() => buttons.classList.add('on'), 350);
  };
  const tuneT = setTimeout(() => { screen.classList.remove('tuning'); type(); }, reduce ? 0 : 1100);

  let line = 0;
  function channel() {
    knob1.classList.toggle('turned');
    screen.classList.add('tuning');
    setTimeout(() => { screen.classList.remove('tuning'); line = (line + 1) % screenLines.length; sub.textContent = screenLines[line]; }, 380);
  }
  const rot = setInterval(() => { if (buttons.classList.contains('on')) { line = (line + 1) % screenLines.length; sub.textContent = screenLines[line]; } }, 4200);

  function enter() {
    // drift through the screen into the glow
    if (room.classList.contains('entering')) return;
    const r = screen.getBoundingClientRect(), R = room.getBoundingClientRect();
    const ox = r.left + r.width / 2 - R.left, oy = r.top + r.height / 2 - R.top;
    room.style.transformOrigin = `${ox}px ${oy}px`;
    room.style.setProperty('--ox', ox + 'px'); room.style.setProperty('--oy', oy + 'px');
    document.body.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--glow').trim();
    arriving = !reduce;
    room.classList.add('entering');
    setTimeout(() => { location.hash = '#/board'; }, reduce ? 0 : 1500);
  }

  cleanupRoute = () => { cancelAnimationFrame(raf); clearTimeout(typeT); clearTimeout(tuneT); clearInterval(rot); };
}

/* =====================================================================
   THE BOARD
   ===================================================================== */
function derived() {
  const { participants = [], movies = [], votes = [], me } = data;
  const nick = Object.fromEntries(participants.map(p => [p.id, p.nickname]));
  const votesBy = {};
  for (const v of votes) (votesBy[v.movie_id] ||= []).push(v.participant_id);
  const myVotes = votes.filter(v => v.participant_id === me).length;
  const myMovies = movies.filter(m => m.participant_id === me).length;
  const ranked = [...movies].sort((a, b) => (votesBy[b.id]?.length || 0) - (votesBy[a.id]?.length || 0) || a.created_at.localeCompare(b.created_at));
  return { nick, votesBy, myVotes, myMovies, ranked, meP: participants.find(p => p.id === me) };
}

function topnav(extra) {
  return h('div', { class: 'topnav' },
    h('a', { href: '#/' }, '← back to the room'),
    h('nav', null,
      store.demo ? h('span', { class: 'demo-flag', title: 'not connected to a database yet: everything stays in this browser' }, 'demo mode') : null,
      extra,
      route() !== 'board' ? h('a', { href: '#/board' }, 'the board') : null,
      route() !== 'archive' ? h('a', { href: '#/archive' }, 'archive') : null,
      route() !== 'host' ? h('a', { href: '#/host' }, 'host') : null));
}

function renderBoard(quiet = false) {
  const ev = data.event;
  if (!ev) { $app.replaceChildren(h('div', { class: 'loading' }, 'no movie night is open right now.')); return; }
  const D = derived();
  const open = ev.status === 'open';
  const winner = ev.winner_movie_id && data.movies.find(m => m.id === ev.winner_movie_id);

  const when = ev.final_date ? fmtDay(ev.final_date) + (ev.final_time ? ' · ' + ev.final_time : '') : 'tbd — pick below';

  const page = h('div', { class: 'page' + (quiet ? ' quiet' : arriving ? ' arrive' : '') },
    h('div', { class: 'page-top' }),
    h('div', { class: 'wrap' },
      topnav(),
      h('header', { class: 'titlecard' },
        h('div', { class: 'kicker' }, 'night no. ' + ev.number + ' · ' + (THEMES[ev.theme]?.name || '')),
        h('h1', null, ev.title),
        ev.tagline ? h('p', { class: 'tagline' }, ev.tagline) : null,
        h('div', { class: 'rule' })),
      h('div', { class: 'facts' },
        fact('where', ev.location || 'tbd'),
        fact('when', when),
        fact('bring', ev.bring || 'yourself')),

      winner ? h('section', { class: 'block' },
        h('div', { class: 'section-head' }, h('h2', null, 'tonight’s feature'), h('p', null, 'decided by the tickets. see you there.')),
        h('div', { class: 'pool' }, ticket(winner, D, { winner: true }))) : null,

      h('section', { class: 'block', id: 'pool' },
        h('div', { class: 'section-head' },
          h('h2', null, 'the pool', h('small', null, data.movies.length + (data.movies.length === 1 ? ' film' : ' films'))),
          h('p', null, open
            ? `everyone suggests up to ${LIMITS.movies} films and has ${LIMITS.votes} tickets to give.`
            : 'voting is closed. the host is choosing the feature.')),
        h('div', { class: 'pool' },
          D.ranked.length ? D.ranked.filter(m => m !== winner).map((m, i) => ticket(m, D, { i }))
            : h('div', { class: 'empty' }, 'the pool is empty. be the first to bring a film.',
                h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn accent', onclick: openAddFilm }, '+ add a film'))))),

      h('section', { class: 'block' },
        h('div', { class: 'section-head' },
          h('h2', null, 'when?'),
          h('p', null, ev.final_date ? 'it’s settled.' : 'suggest days that work, tick the ones others suggested.')),
        ev.final_date ? itsOn(ev) : dateCards(D)),

      h('section', { class: 'block' },
        h('div', { class: 'section-head' },
          h('h2', null, 'the guestbook', h('small', null, (data.participants?.length || 0) + ' signed')),
          h('p', null, 'who’s coming and what they’re carrying in.')),
        data.participants?.length
          ? h('div', { class: 'guestbook' }, data.participants.map(p => h('div', null, h('b', null, p.nickname), h('span', null, p.bringing || ''))))
          : h('div', { class: 'empty' }, 'nobody has signed yet.'))),
    youbar(D, open));
  $app.replaceChildren(page);
}

function fact(k, v) { return h('div', { class: 'fact' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }

function ticket(m, D, { winner = false, i = 0 } = {}) {
  const voters = D.votesBy[m.id] || [];
  const mineVote = voters.includes(data.me);
  const mine = m.participant_id && m.participant_id === data.me;
  const open = data.event.status === 'open';
  const btn = h('button', {
    class: 'ticket-btn' + (mineVote ? ' on' : ''), 'aria-pressed': String(mineVote), disabled: !open,
    title: mineVote ? 'take your ticket back' : 'give this film a ticket',
    onclick: async e => {
      const b = e.currentTarget;
      await needJoin(async () => {
        try {
          await store.toggleVote(m.id);
          b.classList.add('punch');
          await reload(); softRerender();
        } catch (err) { toast(friendlyError(err)); }
      });
    },
  }, ticketIcon(), h('span', null, String(voters.length)), h('span', { class: 'sr' }, voters.length === 1 ? 'ticket' : 'tickets'));

  return h('article', { class: 'ticket' + (mine ? ' mine' : '') + (winner ? ' winner' : ''), style: `animation-delay:${Math.min(i, 10) * 40}ms` },
    winner ? h('div', { class: 'ribbon' }, 'feature') : null,
    poster(m),
    h('div', { class: 'tbody' },
      h('h3', null, m.title),
      h('div', { class: 'meta' }, [m.year, 'from ' + (D.nick[m.participant_id] || 'someone')].filter(Boolean).join(' · ')),
      m.note ? h('p', { class: 'note' }, '“' + m.note + '”') : null,
      h('div', { class: 'foot' },
        h('div', { class: 'who' }, voters.length ? 'tickets from ' + voters.map(v => D.nick[v] || '?').join(', ') : 'no tickets yet'),
        btn)),
    mine && open ? h('button', {
      class: 'x', title: 'remove your suggestion',
      onclick: async () => { try { await store.removeMovie(m.id); toast('taken out of the pool.'); await reload(); softRerender(); } catch (e) { toast(friendlyError(e)); } },
    }, 'remove') : null);
}

function itsOn(ev) {
  return h('div', { class: 'its-on' },
    h('div', null, h('div', { class: 'k' }, 'it’s on'), h('div', { class: 'big' }, fmtDay(ev.final_date, { weekday: 'long', day: 'numeric', month: 'long' }))),
    ev.final_time ? h('div', null, h('div', { class: 'k' }, 'doors'), h('div', { class: 'big' }, ev.final_time)) : null);
}

function dateCards(D) {
  const opts = data.dateOptions || [];
  const dv = data.dateVotes || [];
  const by = id => dv.filter(v => v.date_option_id === id).map(v => v.participant_id);
  const best = Math.max(0, ...opts.map(o => by(o.id).length));
  const today = localToday();
  // starts on today; nothing is sent until "add this day" is pressed,
  // so typing a year digit by digit can't submit a half-typed date
  const input = h('input', { type: 'date', min: today, value: today, 'aria-label': 'suggest a date' });
  const addDay = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const day = input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) { toast('pick a day from today on.'); return input.focus(); }
    await needJoin(async () => {
      try { await store.proposeDate(data.event.id, day); toast('date added — you’re marked as free.'); input.blur(); await reload(); softRerender(); }
      catch (e) { toast(friendlyError(e)); }
    });
  } }, 'add this day');
  return h('div', { class: 'dates' },
    opts.map(o => {
      const who = by(o.id); const on = who.includes(data.me);
      return h('button', {
        class: 'datecard' + (on ? ' on' : '') + (who.length && who.length === best ? ' best' : ''), 'aria-pressed': String(on),
        title: on ? 'tap if you can’t make it after all' : 'tap if this day works for you',
        onclick: () => needJoin(async () => { try { await store.toggleDate(o.id); await reload(); softRerender(); } catch (e) { toast(friendlyError(e)); } }),
      },
        h('div', { class: 'mon' }, fmtDay(o.day, { month: 'long' })),
        h('div', { class: 'day' }, fmtDay(o.day, { day: 'numeric' })),
        h('div', { class: 'wd' }, fmtDay(o.day, { weekday: 'long' })),
        h('div', { class: 'cnt' }, who.length ? who.length + ' can: ' + who.map(id => D.nick[id] || '?').join(', ') : 'nobody yet'));
    }),
    h('div', { class: 'datecard add' }, h('span', null, '+ suggest a day'), input, addDay));
}

function youbar(D, open) {
  if (!data.me) {
    return h('div', { class: 'youbar' },
      h('span', { class: 'hi' }, 'just looking?'),
      h('button', { class: 'btn small', onclick: () => openJoin() }, 'sign the guestbook'));
  }
  const left = LIMITS.votes - D.myVotes;
  return h('div', { class: 'youbar' },
    h('span', { class: 'hi' }, 'hi, ', h('button', { onclick: () => openJoin(true), title: 'change nickname' }, D.meP?.nickname || 'friend')),
    h('span', { class: 'stat films' }, `films ${D.myMovies}/${LIMITS.movies}`),
    h('span', { class: 'stat', title: left + ' tickets left' }, 'tickets',
      h('span', { class: 'stubs' }, Array.from({ length: LIMITS.votes }, (_, i) => h('i', { class: i < left ? '' : 'used' })))),
    open ? h('button', { class: 'btn small', onclick: openAddFilm, disabled: D.myMovies >= LIMITS.movies }, '+ add a film') : null);
}

/* ---------------- modals ---------------- */
function modal(content, { onClose } = {}) {
  const prev = document.activeElement;
  const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(); } });
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('button', { class: 'close', onclick: () => close() }, 'close ×'), content);
  back.append(box);
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  document.body.append(back);
  function close() {
    back.remove(); document.removeEventListener('keydown', esc); prev?.focus?.();
    onClose?.(); if (pendingRender) { pendingRender = false; softRerender(); }
  }
  setTimeout(() => box.querySelector('input,textarea,button:not(.close)')?.focus(), 30);
  return { close, box };
}

function needJoin(fn) {
  if (data.me) return fn();
  openJoin(false, fn);
}

function openJoin(editing = false, then) {
  const p = data.participants?.find(x => x.id === data.me);
  const bringOpts = ['snacks', 'a blanket', 'tea', 'something to drink', 'just myself'];
  let bringing = p?.bringing || '';
  const nick = h('input', { maxlength: 24, required: true, value: p?.nickname || lastNickname.get() || '', placeholder: 'e.g. the projectionist', autocomplete: 'nickname' });
  const other = h('input', { maxlength: 60, placeholder: 'or write your own', value: bringOpts.includes(bringing) ? '' : bringing });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...bringOpts.map(o => h('button', {
    type: 'button', class: 'chip' + (bringing === o ? ' on' : ''),
    onclick: () => { bringing = bringing === o ? '' : o; other.value = ''; drawChips(); },
  }, o)));
  drawChips();
  other.addEventListener('input', () => { bringing = other.value; drawChips(); });
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      const n = nick.value.trim(); if (!n) return nick.focus();
      try {
        await store.join(data.event.id, n, bringing.trim());
        lastNickname.set(n);
        m.close(); await reload(); softRerender();
        toast(editing ? 'updated.' : 'welcome in, ' + n + '.');
        if (then) then();
      } catch (err) { toast(friendlyError(err)); }
    },
  },
    h('div', { class: 'kicker' }, 'night no. ' + data.event.number),
    h('h2', null, editing ? 'your name tag' : 'sign the guestbook'),
    h('p', { class: 'lead' }, 'any nickname will do. you can be someone different every night.'),
    h('label', { class: 'field' }, h('span', null, 'nickname'), nick),
    h('div', { class: 'field' }, h('span', null, 'i’ll bring'), chips, h('div', { style: 'margin-top:8px' }, other)),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, editing ? 'save' : 'sign in ink')));
  const m = modal(form);
}

function openAddFilm() {
  needJoin(() => {
    const D = derived();
    if (D.myMovies >= LIMITS.movies) return toast(friendlyError('limit_movies'));
    let picked = null, timer, seq = 0;
    const body = h('div');
    const q = h('input', { type: 'search', placeholder: 'start typing a title…', autocomplete: 'off', 'aria-label': 'film title' });
    const list = h('ul', { class: 'results' });
    const status = h('div', { class: 'searching' });
    const manual = h('div', { class: 'manual' });

    const showSearch = () => {
      body.replaceChildren(
        h('div', { class: 'kicker' }, 'the projection booth'),
        h('h2', null, 'add a film'),
        h('p', { class: 'lead' }, `pick the right one from the list. you have ${LIMITS.movies - D.myMovies} of ${LIMITS.movies} suggestions left.`),
        h('label', { class: 'field' }, h('span', null, 'title'), q), status, list, manual);
      q.focus();
    };
    const drawManual = () => manual.replaceChildren(q.value.trim().length > 1
      ? h('span', null, 'can’t find it? ', h('button', { type: 'button', onclick: () => pick({ title: q.value.trim(), year: null, manual: true }) }, `add “${q.value.trim()}” by hand`))
      : '');
    q.addEventListener('input', () => {
      clearTimeout(timer); drawManual();
      const v = q.value.trim();
      if (v.length < 2) { list.replaceChildren(); status.textContent = ''; return; }
      status.textContent = 'searching the archives…';
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const res = await searchFilms(v);
          if (my !== seq) return;
          status.textContent = res.length ? '' : 'nothing found. try the original title, or add it by hand.';
          list.replaceChildren(...res.map(r => h('li', null, h('button', { type: 'button', onclick: () => pick(r) },
            h('div', { class: 'thumb', style: r.poster ? '' : `background:${posterColors[Math.abs(hash(r.title)) % posterColors.length]}` },
              r.poster ? h('img', { src: r.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.remove() }) : r.title.slice(0, 1)),
            h('div', null,
              h('b', null, r.title, ' ', h('span', { class: 'yr' }, r.year ? '(' + r.year + ')' : '')),
              r.blurb ? h('small', null, r.blurb) : null)))));
        } catch (e) {
          if (my !== seq) return;
          status.textContent = 'the search is napping. add it by hand below.';
          list.replaceChildren();
        }
      }, 350);
    });

    function pick(r) {
      picked = { ...r };
      const note = h('textarea', { maxlength: 140, placeholder: 'why this one? (optional — one line is plenty)' });
      const title = h('input', { value: r.title, maxlength: 200 });
      const year = h('input', { type: 'number', min: 1880, max: 2100, value: r.year || '', placeholder: 'year' });
      const submit = h('button', { class: 'btn primary', type: 'submit' }, 'add to the pool');
      body.replaceChildren(h('form', {
        onsubmit: async e => {
          e.preventDefault(); submit.disabled = true;
          const film = { ...picked, note: note.value.trim() };
          if (picked.manual) { film.title = title.value.trim(); film.year = +year.value || null; if (!film.title) { submit.disabled = false; return title.focus(); } }
          try {
            await store.addMovie(data.event.id, film);
            m.close(); toast('in the pool. now go give it a ticket.');
            await reload(); softRerender();
            setTimeout(() => document.getElementById('pool')?.scrollIntoView({ behavior: 'smooth' }), 50);
          } catch (err) { submit.disabled = false; toast(friendlyError(err)); }
        },
      },
        h('div', { class: 'kicker' }, 'the projection booth'),
        h('h2', null, 'good choice.'),
        picked.manual
          ? h('div', null, h('label', { class: 'field' }, h('span', null, 'title'), title), h('label', { class: 'field' }, h('span', null, 'year'), year))
          : h('div', { class: 'picked' }, poster(picked), h('div', null, h('h3', null, picked.title), h('div', { class: 'meta' }, picked.year || ''))),
        h('label', { class: 'field' }, h('span', null, 'a note for the others'), note),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: showSearch }, '← back'), submit)));
      setTimeout(() => (picked.manual ? title : note).focus(), 20);
    }

    const m = modal(body);
    showSearch();
  });
}

/* =====================================================================
   ARCHIVE
   ===================================================================== */
async function renderArchive() {
  applyEventTheme();
  $app.replaceChildren(h('div', { class: 'loading' }, 'rewinding the tapes…'));
  let nights = [];
  try { nights = await store.archive(); } catch (e) { toast(friendlyError(e)); }
  const page = h('div', { class: 'page' }, h('div', { class: 'page-top' }), h('div', { class: 'wrap' },
    topnav(),
    h('header', { class: 'titlecard' },
      h('div', { class: 'kicker' }, cfg.CLUB_NAME || 'the picture club'),
      h('h1', null, 'the archive'),
      h('p', { class: 'tagline' }, 'every night we’ve had, and the film that won it.'),
      h('div', { class: 'rule' })),
    nights.length ? nights.map(n => {
      const w = n.movies.find(m => m.id === n.winner_movie_id) || n.movies[0];
      const nick = Object.fromEntries(n.participants.map(p => [p.id, p.nickname]));
      const t = themeColors(n.theme, n.colors);
      const day = n.final_date ? fmtDay(n.final_date, { day: 'numeric', month: 'long', year: 'numeric' }) : (n.archived_at ? fmtDay(n.archived_at.slice(0, 10), { month: 'long', year: 'numeric' }) : '');
      return h('article', { class: 'reel', style: `--swatch:${t.wall}` },
        w ? poster(w) : h('div', { class: 'poster type', style: `background:${t.wall}` }, h('b', null, '—'), h('span')),
        h('div', null,
          h('div', { class: 'kicker' }, ['night no. ' + n.number, day, t.name].filter(Boolean).join(' · ')),
          h('h3', null, n.title),
          w ? h('div', { class: 'feature' }, 'the feature: ', h('b', null, w.title), w.year ? ' (' + w.year + ')' : '',
            w.tickets ? ' — ' + w.tickets + (w.tickets === 1 ? ' ticket' : ' tickets') : '',
            nick[w.participant_id] ? ', brought by ' + nick[w.participant_id] : '') : h('div', { class: 'feature' }, 'no films that night.'),
          n.movies.filter(m => m !== w).length ? h('div', { class: 'also' }, n.movies.filter(m => m !== w).map(m => h('span', null, m.title + ' · ' + m.tickets))) : null,
          n.participants.length ? h('div', { class: 'guests' }, 'in the room: ' + n.participants.map(p => p.nickname).join(', ')) : null));
    }) : h('div', { class: 'empty' }, 'nothing here yet. the first night will land here once the host wraps it up.')));
  $app.replaceChildren(page);
}

/* =====================================================================
   HOST
   ===================================================================== */
async function renderHost(quiet = false) {
  const key = hostKeyStore.get();
  if (!key) return hostLogin();
  const ev = data.event;
  if (!ev) { $app.replaceChildren(h('div', { class: 'loading' }, 'no open night.')); return; }
  const D = derived();
  const save = async (patch, msg = 'saved.') => {
    try { await store.hostUpdate(key, ev.id, patch); await reload(); toast(msg); renderHost(true); }
    catch (e) { if (String(e.message).includes('bad_host_key')) { hostKeyStore.clear(); return hostLogin('that key no longer works.'); } toast(friendlyError(e)); }
  };
  const armed = (label, armedLabel, fn) => {
    let t;
    const b = h('button', { class: 'btn small danger', type: 'button', onclick: () => {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = armedLabel; t = setTimeout(() => { b.classList.remove('armed'); b.textContent = label; }, 3500); return; }
      clearTimeout(t); fn();
    } }, label);
    return b;
  };

  const f = {
    title: h('input', { value: ev.title, maxlength: 80 }),
    tagline: h('textarea', { maxlength: 200 }, ev.tagline || ''),
    location: h('input', { value: ev.location || '' }),
    bring: h('input', { value: ev.bring || '' }),
  };
  const dateIn = h('input', { type: 'date', value: ev.final_date || localToday() });
  const timeIn = h('input', { type: 'time', value: ev.final_time || '' });
  const dv = data.dateVotes || [];
  const optRanked = [...(data.dateOptions || [])].map(o => ({ o, n: dv.filter(v => v.date_option_id === o.id).length })).sort((a, b) => b.n - a.n);

  const page = h('div', { class: 'page' + (quiet ? ' quiet' : '') }, h('div', { class: 'page-top' }), h('div', { class: 'wrap' },
    topnav(),
    h('header', { class: 'titlecard' },
      h('div', { class: 'kicker' }, 'host only'),
      h('h1', null, 'the projection room'),
      h('p', { class: 'tagline' }, 'set the scene, pick the date, close the vote, roll the film.'),
      h('div', { class: 'rule' })),
    h('div', { class: 'hostgrid' },
      h('form', { class: 'card', onsubmit: e => { e.preventDefault(); save({ title: f.title.value.trim() || ev.title, tagline: f.tagline.value.trim(), location: f.location.value.trim(), bring: f.bring.value.trim() }); } },
        h('h3', null, 'the night'),
        h('label', { class: 'field' }, h('span', null, 'title'), f.title),
        h('label', { class: 'field' }, h('span', null, 'tagline'), f.tagline),
        h('label', { class: 'field' }, h('span', null, 'where'), f.location),
        h('label', { class: 'field' }, h('span', null, 'bring'), f.bring),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'save'))),

      h('div', { class: 'card' },
        h('h3', null, 'the look'),
        h('div', { class: 'themes' }, Object.entries(THEMES).map(([k, t]) => h('button', {
          class: 'theme-sw' + (ev.theme === k && !ev.colors ? ' on' : ''), type: 'button',
          onclick: () => { previewColors = null; applyTheme(k); save({ theme: k, colors: null }, 'new wallpaper: ' + t.name + '.'); },
        }, h('div', { class: 'bars' }, [t.wall, t.wood, t.accent, t.accent2, t.rug1].map(c => h('i', { style: 'background:' + c }))), t.name))),
        h('p', { class: 'note-small' }, 'changes the room, the board and the tv glow for everyone.'),
        colorPicker(ev, save),
        h('h3', { style: 'margin-top:24px' }, 'the date'),
        optRanked.length ? h('ul', { class: 'hostlist' }, optRanked.map(({ o, n }) => h('li', null,
          h('span', null, fmtDay(o.day)), h('span', { class: 'n' }, n + ' can'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { dateIn.value = o.day; } }, 'use')))) : h('p', { class: 'note-small' }, 'no dates suggested yet.'),
        h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px' },
          h('label', { class: 'field' }, h('span', null, 'final date'), dateIn),
          h('label', { class: 'field' }, h('span', null, 'doors at'), timeIn)),
        h('div', { class: 'actions' },
          ev.final_date ? h('button', { class: 'btn small', type: 'button', onclick: () => save({ final_date: '', final_time: '' }, 'date poll reopened.') }, 'reopen the poll') : null,
          h('button', { class: 'btn primary', type: 'button', onclick: () => dateIn.value ? save({ final_date: dateIn.value, final_time: timeIn.value }, 'date set. the board says it’s on.') : toast('pick a date first.') }, 'set the date'))),

      h('div', { class: 'card' },
        h('h3', null, 'the vote'),
        h('p', { class: 'note-small', style: 'margin:0 0 12px' }, ev.status === 'open' ? 'open — people can add films and give tickets.' : 'closed — the pool is frozen.'),
        h('div', { class: 'actions', style: 'justify-content:flex-start;margin-bottom:14px' },
          ev.status === 'open'
            ? h('button', { class: 'btn', type: 'button', onclick: () => save({ status: 'locked' }, 'voting closed.') }, 'close voting')
            : h('button', { class: 'btn', type: 'button', onclick: () => save({ status: 'open' }, 'voting reopened.') }, 'reopen voting')),
        D.ranked.length ? h('ul', { class: 'hostlist' }, D.ranked.map(m => h('li', null,
          h('span', null, (ev.winner_movie_id === m.id ? '★ ' : '') + m.title + (m.year ? ' (' + m.year + ')' : '')),
          h('span', { class: 'n' }, (D.votesBy[m.id]?.length || 0) + ' 🎟'),
          h('span', { style: 'display:flex;gap:6px' },
            ev.winner_movie_id === m.id
              ? h('button', { class: 'btn small', type: 'button', onclick: () => save({ winner_movie_id: '' }, 'feature un-picked.') }, 'unpick')
              : h('button', { class: 'btn small', type: 'button', onclick: () => save({ winner_movie_id: m.id }, m.title + ' is the feature.') }, 'feature'),
            armed('remove', 'sure?', async () => { try { await store.hostRemoveMovie(key, m.id); await reload(); toast('removed.'); renderHost(true); } catch (e) { toast(friendlyError(e)); } }))))) : h('p', { class: 'note-small' }, 'no films yet.')),

      h('div', { class: 'card' },
        h('h3', null, 'wrap up the night'),
        h('p', { class: 'note-small', style: 'margin:0 0 14px' }, 'moves this night into the archive (the feature is the film you picked, or the one with most tickets) and opens night no. ' + (ev.number + 1) + ' with a fresh, empty pool. the same page, link and theme stay.'),
        armed('archive & start the next night', 'tap again to confirm', async () => {
          try { await store.hostArchiveAndNew(key, ev.id); await reload(); toast('archived. a new night is open.'); location.hash = '#/board'; }
          catch (e) { toast(friendlyError(e)); }
        }),
        h('div', { style: 'margin-top:22px;display:flex;gap:18px;flex-wrap:wrap' },
          h('button', { class: 'linkish', style: 'color:var(--ink)', type: 'button', onclick: () => { hostKeyStore.clear(); hostLogin(); } }, 'forget host key on this device'),
          store.demo ? h('button', { class: 'linkish', style: 'color:var(--ink)', type: 'button', onclick: async () => { store.reset(); hostKeyStore.clear(); await reload(); toast('demo reset.'); hostLogin(); } }, 'reset demo data') : null)))));
  $app.replaceChildren(page);
  // leaving the host page drops any colours that were tried but not saved
  cleanupRoute = () => { if (previewColors) { previewColors = null; applyEventTheme(); } };
}

// fine-tune the current theme colour by colour; previews live, saves for everyone
function colorPicker(ev, save) {
  const base = THEMES[ev.theme] || THEMES.moss;
  const current = themeColors(ev.theme, ev.colors);
  const draft = Object.fromEntries(COLOR_SLOTS.map(([k]) => [k, current[k]]));
  const saveBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => {
    // store only what differs from the preset, so switching presets later stays clean
    const diff = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== base[k]));
    previewColors = null;
    save({ colors: Object.keys(diff).length ? diff : null }, 'colours saved.');
  } }, 'save colours');
  const swatches = COLOR_SLOTS.map(([k, label]) => {
    const input = h('input', { type: 'color', value: draft[k], 'aria-label': label });
    input.addEventListener('input', () => {
      draft[k] = input.value.toLowerCase();
      previewColors = { ...draft };
      applyTheme(ev.theme, previewColors);
      saveBtn.disabled = false;
    });
    return h('label', { class: 'swatch' }, input, h('span', null, label));
  });
  return h('div', null,
    h('h3', { style: 'margin-top:24px' }, 'fine-tune the colours'),
    h('p', { class: 'note-small', style: 'margin:0 0 10px' }, 'tap a circle to change it. you see it right away; others see it once you save.'),
    h('div', { class: 'swatches' }, swatches),
    h('div', { class: 'actions' },
      ev.colors || previewColors ? h('button', { class: 'btn small', type: 'button', onclick: () => {
        previewColors = null;
        save({ colors: null }, 'back to ' + base.name + '.');
      } }, 'back to ' + base.name) : null,
      saveBtn));
}

async function hostLogin(msg) {
  let hasKey = true;
  try { hasKey = await store.hostHasKey(); } catch {}
  const input = h('input', { type: 'password', minlength: 6, autocomplete: 'current-password', placeholder: hasKey ? 'host key' : 'choose a host key (6+ characters)' });
  const page = h('div', { class: 'page' }, h('div', { class: 'page-top' }), h('div', { class: 'wrap' },
    topnav(),
    h('header', { class: 'titlecard' },
      h('div', { class: 'kicker' }, 'host only'),
      h('h1', null, 'the projection room'),
      h('p', { class: 'tagline' }, hasKey ? 'the door is locked. the host has the key.' : 'nobody holds the key yet. choose one now — whoever sets it first is the host.'),
      h('div', { class: 'rule' })),
    h('form', {
      class: 'card', style: 'max-width:460px;margin:0 auto',
      onsubmit: async e => {
        e.preventDefault();
        try {
          const ok = await store.hostClaim(input.value);
          if (!ok) return toast('that host key is not right.');
          hostKeyStore.set(input.value); toast(hasKey ? 'welcome back, host.' : 'key set. you are the host.'); renderHost();
        } catch (err) { toast(friendlyError(err)); }
      },
    },
      h('label', { class: 'field' }, h('span', null, hasKey ? 'host key' : 'new host key'), input),
      msg ? h('p', { class: 'note-small' }, msg) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, hasKey ? 'unlock' : 'set key & enter')))));
  $app.replaceChildren(page);
  input.focus();
}

/* =====================================================================
   boot
   ===================================================================== */
(async function boot() {
  applyTheme('moss');
  $app.replaceChildren(h('div', { class: 'loading' }, 'warming up the tubes…'));
  try { store = await createStore(); }
  catch (e) {
    console.error(e);
    $app.replaceChildren(h('div', { class: 'loading' }, 'could not connect to the board. check config.js.'));
    return;
  }
  await reload();
  // only redraw when something actually changed (polls and tab switches used to flash the page)
  store.subscribe(async () => {
    const before = JSON.stringify(data);
    await reload();
    if (JSON.stringify(data) !== before) softRerender();
  });
  window.addEventListener('hashchange', render);
  render();
})();

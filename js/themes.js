// Each night can have its own look. The host picks one on the host page.
export const THEMES = {
  moss: {
    name: 'moss room',
    wall: '#5b6a3c', wall2: '#536135', wood: '#8b5a2b', wood2: '#6b4321', accent: '#d4848c', accent2: '#e8c07a',
    paper: '#f4ead5', ink: '#2b2620', floor: '#7a4e2a', rug1: '#8f2f2a', rug2: '#1f3a5a', rug3: '#e3c58a',
    glow: '#fff1c9', glow2: '#cfe9ec',
  },
  pink: {
    name: 'hotel pink',
    wall: '#dc9aa6', wall2: '#d38e9b', wood: '#7b3f3a', wood2: '#5e2c2a', accent: '#6a3566', accent2: '#f0cf8a',
    paper: '#fbefe2', ink: '#2c1d27', floor: '#8a3f3c', rug1: '#a8323b', rug2: '#3c2a5e', rug3: '#f2d8a3',
    glow: '#fff3df', glow2: '#f8d2da',
  },
  scout: {
    name: 'scout camp',
    wall: '#cfa441', wall2: '#c49a3a', wood: '#7b5530', wood2: '#5a3c20', accent: '#b2492e', accent2: '#e9dfb3',
    paper: '#f5ecd2', ink: '#2a2418', floor: '#6c4a2b', rug1: '#3f5c3a', rug2: '#b2492e', rug3: '#e9dfb3',
    glow: '#fff6d6', glow2: '#d8ecd0',
  },
  sea: {
    name: 'deep sea',
    wall: '#3d7c88', wall2: '#37727e', wood: '#8a6a45', wood2: '#5e4529', accent: '#d8432f', accent2: '#f2d16b',
    paper: '#eef0e6', ink: '#14262b', floor: '#5d4a35', rug1: '#1b3e5c', rug2: '#d8432f', rug3: '#f2d16b',
    glow: '#e9fbff', glow2: '#a6e3ea',
  },
  desert: {
    name: 'desert town',
    wall: '#e3ad84', wall2: '#d9a37a', wood: '#9a6a43', wood2: '#704829', accent: '#6fb3aa', accent2: '#e0644b',
    paper: '#fbf1e1', ink: '#2f2219', floor: '#a26c44', rug1: '#e0644b', rug2: '#3e7d8c', rug3: '#f6dfb4',
    glow: '#fff4dc', glow2: '#bfe8e2',
  },
  train: {
    name: 'night train',
    wall: '#2e4466', wall2: '#293d5c', wood: '#7a4a2a', wood2: '#55311b', accent: '#d79a32', accent2: '#a4c9b6',
    paper: '#f3ead6', ink: '#1a1f2b', floor: '#4b2f20', rug1: '#8e2b2b', rug2: '#d79a32', rug3: '#efe0bd',
    glow: '#fff0cc', glow2: '#bcd6f2',
  },
};

// colour slots the host can fine-tune on the host page (keys match the theme fields above)
export const COLOR_SLOTS = [
  ['wall', 'wallpaper'], ['wood', 'wood'], ['floor', 'floor'], ['paper', 'paper'], ['ink', 'ink'],
  ['accent', 'accent'], ['accent2', 'accent 2'], ['rug1', 'rug 1'], ['rug2', 'rug 2'], ['rug3', 'rug 3'],
  ['glow', 'tv glow'],
];
const HEX = /^#[0-9a-f]{6}$/i;
const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');

// a preset theme with the host's overrides on top; stripe/shadow tones follow the picked colour
export function themeColors(key, colors) {
  const t = { ...(THEMES[key] || THEMES.moss) };
  for (const [k] of COLOR_SLOTS) {
    const v = colors?.[k];
    if (typeof v === 'string' && HEX.test(v)) t[k] = v.toLowerCase();
  }
  if (t.wall !== (THEMES[key] || THEMES.moss).wall) t.wall2 = shade(t.wall, 0.91);
  if (t.wood !== (THEMES[key] || THEMES.moss).wood) t.wood2 = shade(t.wood, 0.77);
  return t;
}

export function applyTheme(key, colors) {
  const t = themeColors(key, colors);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) if (k !== 'name') root.setProperty('--' + k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.wall);
  document.body.style.backgroundColor = t.wall;
}

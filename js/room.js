// What's in the room and in which style. The host sets it on the host page;
// the allowed values must match _clean_room() in supabase/schema.sql.

export const ROOM_STYLES = [
  { key: 'sofa',   label: 'sofa',   options: [['velvet', 'velvet'], ['leather', 'leather'], ['plaid', 'plaid'], ['none', 'none']] },
  { key: 'rug',    label: 'rug',    options: [['wool', 'wool'], ['persian', 'persian'], ['round', 'round braided'], ['none', 'none']] },
  { key: 'lamps',  label: 'lamps',  options: [['sconces', 'wall sconces'], ['floor', 'floor lamps'], ['none', 'none']] },
  { key: 'plants', label: 'plants', options: [['snake', 'snake plant'], ['fern', 'fern'], ['cactus', 'cactus'], ['none', 'none']] },
];

export const ROOM_TOGGLES = [
  ['plaque', 'plaque'], ['pillows', 'pillows'], ['blanket', 'blanket'],
  ['window', 'window'], ['shelf', 'bookshelf'], ['record', 'record player'],
  ['garland', 'fairy lights'], ['chair', 'armchair'], ['popcorn', 'popcorn'],
];

export const ROOM_DEFAULTS = {
  sofa: 'velvet', rug: 'wool', lamps: 'sconces', plants: 'snake',
  plaque: 'on', pillows: 'on', blanket: 'on',
  window: 'off', shelf: 'off', record: 'off', garland: 'off', chair: 'off', popcorn: 'off',
};

const ALLOWED = Object.fromEntries([
  ...ROOM_STYLES.map(s => [s.key, s.options.map(o => o[0])]),
  ...ROOM_TOGGLES.map(([k]) => [k, ['on', 'off']]),
]);

// defaults with any valid saved choices on top
export function roomConfig(room) {
  const cfg = { ...ROOM_DEFAULTS };
  for (const [k, v] of Object.entries(room || {})) if (ALLOWED[k]?.includes(v)) cfg[k] = v;
  return cfg;
}

// the room's look is driven by data-* attributes, so changes apply without rebuilding it
export function applyRoom(el, room) {
  if (!el) return;
  for (const [k, v] of Object.entries(roomConfig(room))) el.dataset[k] = v;
}

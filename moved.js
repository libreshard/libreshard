// Shards that used to come with LibreShard and now live in the gallery (libreshard/gallery-shards).
//
// They keep their ids, so whatever the user had for them (settings, favorite, place in the menu, app
// rules) is still saved under that id and comes back when they install the shard from the gallery.
// Their keys go through the usual review there: only bundled shards are approved as they are.
//
// Whoever used LibreShard before the version that took a shard out gets a notice once, in the PC
// window, with a button to install it again: a shard used from the tablet leaves no trace, so
// everyone who updates is told, except about a shard they had disabled. A new install shows nothing.

const MOVED = [
  // `was`: the name the user knew, when the gallery's is different
  { id: 'obs', name: 'Stream Control', was: 'OBS Studio' },
  { id: 'edicion-imagen', name: 'Image editing' },
];
const IDS = MOVED.map((m) => m.id);

// The saved answer (config.json "moved"): { pending: [ids still to offer] }, or null before the first
// start of a version with this list
function validMoved(v) {
  return v === null || (!!v && typeof v === 'object' && Array.isArray(v.pending) && v.pending.every((id) => IDS.includes(id)));
}

// What to offer on the first start: every moved shard for someone who used LibreShard before (their
// config.json existed), except the ones they had disabled; nothing for a new install. `state`:
// shards-state.json.
function firstPending({ existingUser, state }) {
  if (!existingUser) return [];
  return IDS.filter((id) => state?.[id]?.disabled !== true);
}

// The shards the notice offers now: pending, and not installed again yet
function offered(pending, isInstalled) {
  return MOVED.filter((m) => pending.includes(m.id) && !isInstalled(m.id));
}

module.exports = { MOVED, validMoved, firstPending, offered };

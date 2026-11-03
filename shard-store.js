// The shard registry: loads and validates shard folders, applies the user's approvals, enabled state
// and app rules, installs and uninstalls, and reloads when the user's shard folder changes.
//
// Approvals (<userData>/shards-state.json): a user shard may only type the keys the user approved.
// Bundled shards ship with the app and are approved as they are. If a manifest gains keys (edited by
// hand, or a shard under development), the new keys stay blocked until approved again.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { validateManifest } = require('./manifest');
const { normalizeApp, appLabel, exeKey } = require('./focus/apps');
const { resolveValues, checkValues } = require('./shard-settings');

// Clean list of app entries (see focus/apps.js), at most 20
function cleanApps(v) {
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v)) return null;
  return v.map(normalizeApp).filter(Boolean).slice(0, 20);
}

// One user rule: { mode: 'any' } or { mode: 'only', apps: [...] }. "only" with no usable apps means any.
function cleanRule(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.mode === 'any') return { mode: 'any', apps: [] };
  if (v.mode === 'only') {
    const apps = cleanApps(v.apps) || [];
    return apps.length ? { mode: 'only', apps } : { mode: 'any', apps: [] };
  }
  return null;
}

// User rules (<userData>/app-rules.json): { "shard-id": rule }. They replace the manifest's apps.
function loadRules(file) {
  const rules = new Map();
  if (!file || !fs.existsSync(file)) return rules;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')); // throws on invalid JSON
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('must be an object');
  for (const [id, v] of Object.entries(raw)) {
    const rule = cleanRule(v);
    if (rule) rules.set(id, rule);
  }
  return rules;
}

// The shard's effective app entries. An empty result means "no restriction".
function resolveApps(manifest, rules) {
  const rule = rules.get(manifest.id);
  if (rule) return rule.mode === 'any' ? [] : rule.apps;
  if (Array.isArray(manifest.apps) && manifest.apps.includes('*')) return [];
  return cleanApps(manifest.apps) || [];
}

// Removes a shard folder. A link (symlink or Windows junction) is removed on its own, never followed,
// so uninstalling a shard that points at a development folder leaves that folder untouched.
function removeShardFolder(root) {
  if (fs.lstatSync(root).isSymbolicLink()) {
    try { fs.unlinkSync(root); } catch { fs.rmdirSync(root); }
  } else {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

class ShardStore extends EventEmitter {
  // dirs: [{ dir, bundled }] in priority order (with a repeated id, the first one wins).
  // installDir: where install() copies shards (the user's folder).
  constructor({ dirs, installDir, stateFile, rulesFile, appVersion, watch = false }) {
    super();
    Object.assign(this, { dirs, installDir, stateFile, rulesFile, appVersion });
    this.state = this.readState();
    this.rules = new Map();
    this.entries = new Map();
    this.rejected = [];
    this.readRules();
    this.load();
    if (watch) this.watch();
  }

  readState() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { return {}; }
  }

  saveState() {
    if (!this.stateFile) return;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2) + '\n');
  }

  // Keeps the previous rules if the file has invalid JSON
  readRules() {
    try { this.rules = loadRules(this.rulesFile); } catch (e) {
      console.warn('Invalid app-rules.json, keeping the previous rules:', e.message);
    }
  }

  load() {
    const entries = new Map();
    const rejected = [];
    for (const { dir, bundled } of this.dirs) {
      if (!dir || !fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const root = path.join(dir, name);
        const manifestFile = path.join(root, 'manifest.json');
        if (!fs.existsSync(manifestFile)) continue;
        let raw;
        try { raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (e) {
          rejected.push({ root, errors: ['manifest.json is not valid JSON: ' + e.message] });
          continue;
        }
        const { ok, errors, manifest } = validateManifest(raw, { appVersion: this.appVersion });
        if (!ok) { rejected.push({ root, id: raw?.id, errors }); continue; }
        if (entries.has(manifest.id)) {
          rejected.push({ root, id: manifest.id, errors: [`id "${manifest.id}" is already used by ${entries.get(manifest.id).root}`] });
          continue;
        }
        const st = this.state[manifest.id] || {};
        const approved = new Set(bundled ? manifest.keys : (Array.isArray(st.approved) ? st.approved : []));
        entries.set(manifest.id, {
          id: manifest.id,
          manifest,
          root,
          realRoot: fs.realpathSync(root),
          bundled: !!bundled,
          linked: fs.lstatSync(root).isSymbolicLink(),
          enabled: !st.disabled,
          allowed: new Set(manifest.keys.filter((k) => approved.has(k))),
          pendingKeys: manifest.keys.filter((k) => !approved.has(k)),
          apps: resolveApps(manifest, this.rules),
          customApps: this.rules.has(manifest.id),
          suggestedApps: cleanApps(manifest.apps) || [],
          settings: resolveValues(manifest.settings, st.settings),
        });
      }
    }
    this.entries = entries;
    this.rejected = rejected;
    if (this.watching) this.watchLinked();
    this.emit('change');
  }

  // Menu order, shared by the PC window and the tablet: favorites first, then the order the user
  // chose (shards-state.json "position"), then by name
  all() {
    const st = (e) => this.state[e.id] || {};
    const name = (e) => String(e.manifest.name || e.id).toLowerCase();
    return [...this.entries.values()].sort((a, b) =>
      (st(b).favorite === true) - (st(a).favorite === true)
      || (st(a).position ?? Infinity) - (st(b).position ?? Infinity)
      || name(a).localeCompare(name(b)));
  }

  isFavorite(id) { return this.state[id]?.favorite === true; }

  // Only enabled shards are served to the tablet
  get(id) {
    const e = this.entries.get(id);
    return e && e.enabled ? e : null;
  }

  publicList() {
    return this.all().filter((e) => e.enabled).map((e) => ({
      id: e.id, name: e.manifest.name, author: e.manifest.author, icon: e.manifest.icon,
      description: e.manifest.description, apps: e.apps.map(appLabel), pending: e.pendingKeys.length > 0,
      settings: e.settings, favorite: this.isFavorite(e.id),
    }));
  }

  mustGet(id) {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown shard "${id}"`);
    return e;
  }

  // Approves every key the shard's manifest declares right now
  approve(id) {
    const e = this.mustGet(id);
    if (e.bundled) return;
    this.state[id] = { ...this.state[id], approved: [...e.manifest.keys] };
    this.saveState();
    this.load();
  }

  setEnabled(id, enabled) {
    this.mustGet(id);
    const st = { ...this.state[id] };
    if (enabled) delete st.disabled; else st.disabled = true;
    this.state[id] = st;
    this.saveState();
    this.load();
  }

  setFavorite(id, on) {
    this.mustGet(id);
    const st = { ...this.state[id] };
    if (on) st.favorite = true; else delete st.favorite;
    this.state[id] = st;
    this.saveState();
    this.load();
  }

  // Moves a shard one place up (-1) or down (+1) among the shards of its group (favorites or the
  // rest), and saves the resulting order for every shard
  move(id, direction) {
    this.mustGet(id);
    if (direction !== -1 && direction !== 1) throw new Error('Direction must be -1 or 1');
    const ids = this.all().map((e) => e.id);
    const i = ids.indexOf(id);
    const j = i + direction;
    if (j < 0 || j >= ids.length || this.isFavorite(ids[j]) !== this.isFavorite(id)) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    ids.forEach((x, n) => { this.state[x] = { ...this.state[x], position: n }; });
    this.saveState();
    this.load();
  }

  uninstall(id) {
    const e = this.mustGet(id);
    if (e.bundled) throw new Error('Bundled shards can be disabled, not uninstalled');
    removeShardFolder(e.root);
    delete this.state[id];
    this.saveState();
    this.load();
  }

  // Copies a validated shard folder into installDir/<id> and approves its keys. Replaces an
  // installed copy of the same shard; refuses to touch bundled or linked (development) shards.
  install(sourceDir, manifest) {
    const existing = this.entries.get(manifest.id);
    if (existing?.bundled) throw new Error(`The id "${manifest.id}" belongs to a bundled shard`);
    if (existing?.linked) throw new Error(`"${manifest.id}" is linked to a development folder; remove the link first`);
    if (existing && path.dirname(existing.root) !== path.resolve(this.installDir)) {
      throw new Error(`"${manifest.id}" is already installed somewhere else: ${existing.root}`);
    }
    const target = path.join(this.installDir, manifest.id);
    if (fs.existsSync(target)) removeShardFolder(target);
    fs.mkdirSync(this.installDir, { recursive: true });
    // Links inside the source are skipped: an installed shard is plain files only
    fs.cpSync(sourceDir, target, { recursive: true, filter: (src) => !fs.lstatSync(src).isSymbolicLink() });
    this.state[manifest.id] = { approved: [...manifest.keys] };
    this.saveState();
    this.load();
    return this.entries.get(manifest.id);
  }

  // Changes app-rules.json through `mutate(raw)`, keeping every other shard's rule as it was. A file
  // with invalid JSON is never overwritten: the user may be in the middle of editing it.
  writeRules(mutate) {
    if (!this.rulesFile) throw new Error('No rules file');
    let raw = {};
    if (fs.existsSync(this.rulesFile)) {
      try { raw = JSON.parse(fs.readFileSync(this.rulesFile, 'utf8')); } catch {
        throw new Error('app-rules.json has invalid JSON; fix it or delete it first');
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('app-rules.json must be an object');
    }
    mutate(raw);
    fs.mkdirSync(path.dirname(this.rulesFile), { recursive: true });
    fs.writeFileSync(this.rulesFile, JSON.stringify(raw, null, 2) + '\n');
    this.readRules();
    this.applyRules();
  }

  applyRules() {
    for (const e of this.entries.values()) {
      e.apps = resolveApps(e.manifest, this.rules);
      e.customApps = this.rules.has(e.id);
    }
    this.emit('change');
  }

  // Sets where a shard may act: { mode: 'any' } or { mode: 'only', apps: [...] }
  setRule(id, rule) {
    this.mustGet(id);
    const clean = cleanRule(rule);
    if (!clean) throw new Error('Invalid app rule');
    this.writeRules((raw) => {
      raw[id] = clean.mode === 'any' ? { mode: 'any' } : { mode: 'only', apps: clean.apps };
    });
  }

  // Back to the apps the shard's author suggested in the manifest
  resetRule(id) {
    this.mustGet(id);
    this.writeRules((raw) => { delete raw[id]; });
  }

  // Adds one program (by executable) to a shard's current apps. Used by "allow here too" from the
  // tablet, with the program the PC itself detected.
  addApp(id, app) {
    const e = this.mustGet(id);
    const entry = normalizeApp(app);
    if (!entry || !entry.exe) throw new Error('Only a detected program can be added');
    if (!e.apps.length) return; // already allowed everywhere
    if (e.apps.some((a) => a.exe && exeKey(a.exe) === exeKey(entry.exe))) return;
    this.setRule(id, { mode: 'only', apps: [...e.apps, entry] });
  }

  // Saves the user's values for a shard's settings (each checked against the manifest) and emits
  // 'settings' with the shard id and its full set of values
  setSettings(id, values) {
    const e = this.mustGet(id);
    const clean = checkValues(e.manifest.settings, values);
    this.state[id] = { ...this.state[id], settings: { ...(this.state[id]?.settings || {}), ...clean } };
    this.saveState();
    e.settings = resolveValues(e.manifest.settings, this.state[id].settings);
    this.emit('settings', id, e.settings);
  }

  resetSettings(id) {
    const e = this.mustGet(id);
    const st = { ...this.state[id] };
    delete st.settings;
    this.state[id] = st;
    this.saveState();
    e.settings = resolveValues(e.manifest.settings, {});
    this.emit('settings', id, e.settings);
  }

  // Development mode: links a folder into installDir instead of copying it (a junction on Windows,
  // a symlink elsewhere) and approves the reviewed keys. While watching, edits in that folder are
  // reported at once (see watchLinked).
  link(sourceDir, manifest) {
    if (this.entries.has(manifest.id)) throw new Error(`A shard with the id "${manifest.id}" already exists`);
    const target = path.join(this.installDir, manifest.id);
    if (fs.existsSync(target)) throw new Error(`${target} already exists`);
    fs.mkdirSync(this.installDir, { recursive: true });
    fs.symlinkSync(path.resolve(sourceDir), target, process.platform === 'win32' ? 'junction' : 'dir');
    this.state[manifest.id] = { approved: [...manifest.keys] };
    this.saveState();
    this.load();
    return this.entries.get(manifest.id);
  }

  // Watches the real folder of every linked shard (the user folder's watcher doesn't follow links).
  // A manifest change reloads everything (keys may need approval again); any other change emits
  // 'files' with the shard id, so tablets showing it can reload it.
  watchLinked() {
    for (const w of this.linkWatchers || []) w.close();
    this.linkWatchers = [];
    for (const e of this.entries.values()) {
      if (!e.linked) continue;
      let timer = null;
      const onChange = (_event, name) => {
        if (String(name || '').split(/[\\/]/).pop() === 'manifest.json') return this.scheduleLoad();
        clearTimeout(timer);
        timer = setTimeout(() => this.emit('files', e.id), 150);
      };
      try { this.linkWatchers.push(fs.watch(e.realRoot, { recursive: true }, onChange)); } catch {
        try { this.linkWatchers.push(fs.watch(e.realRoot, onChange)); } catch { /* folder gone */ }
      }
    }
  }

  scheduleLoad() {
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => this.load(), 300);
  }

  // Reloads (debounced) when shard folders change, and re-applies app rules when the rules file changes
  watch() {
    const reload = () => this.scheduleLoad();
    this.watching = true;
    this.watchLinked();
    this.watchers = [];
    for (const { dir, bundled } of this.dirs) {
      if (bundled || !dir || !fs.existsSync(dir)) continue;
      try { this.watchers.push(fs.watch(dir, { recursive: true }, reload)); } catch {
        this.watchers.push(fs.watch(dir, reload)); // recursive isn't supported everywhere
      }
    }
    if (this.rulesFile) {
      this.onRules = () => {
        this.readRules();
        this.applyRules();
      };
      fs.watchFile(this.rulesFile, { interval: 1000 }, this.onRules);
    }
  }

  close() {
    this.watching = false;
    clearTimeout(this.loadTimer);
    for (const w of [...(this.watchers || []), ...(this.linkWatchers || [])]) w.close();
    if (this.onRules) fs.unwatchFile(this.rulesFile, this.onRules);
  }
}

module.exports = { ShardStore, loadRules, resolveApps, cleanApps, cleanRule, removeShardFolder };

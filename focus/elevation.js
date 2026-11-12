// Windows drops keys injected into a window whose process runs at a higher integrity level than ours
// (UIPI): a game started "as administrator" ignores LibreShard unless LibreShard is elevated too, and
// SendInput reports nothing. This reads the integrity level from each process's token so the server
// can say so instead of pressing into the void.
//
// It only ever answers "above" when it actually read a higher level. Any failure (no koffi, another
// system, a process that denies access such as an anti-cheat or a system service) is null: unknown,
// and the caller presses as usual. Checked on 2026-11-11 from a normal process: an elevated Notepad
// and Valheim read "high", the same apps started normally read "medium".
//
// Native calls go through koffi (an optional dependency, loaded lazily, Windows only). One reading
// takes a few microseconds, so nothing is cached except our own level.
const { nullLog, once } = require('../log');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TOKEN_INTEGRITY_LEVEL = 25;

// The Windows calls this module needs, through koffi: { processLevel(pid), ownLevel() }, each
// returning the integrity RID (0x2000 medium, 0x3000 high…) or null
function windowsApi() {
  const koffi = require('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  const OpenProcess = kernel32.func('void *__stdcall OpenProcess(uint32 access, int inherit, uint32 pid)');
  const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *h)');
  const GetCurrentProcess = kernel32.func('void *__stdcall GetCurrentProcess()');
  const OpenProcessToken = advapi32.func('int __stdcall OpenProcessToken(void *process, uint32 access, _Out_ void **token)');
  const GetTokenInformation = advapi32.func('int __stdcall GetTokenInformation(void *token, int cls, _Out_ uint8_t *buf, uint32 len, _Out_ uint32 *ret)');
  const GetSidSubAuthorityCount = advapi32.func('uint8_t *__stdcall GetSidSubAuthorityCount(void *sid)');
  const GetSidSubAuthority = advapi32.func('uint32_t *__stdcall GetSidSubAuthority(void *sid, uint32 n)');

  // TOKEN_MANDATORY_LABEL starts with a pointer to the label's SID; its last sub-authority is the level
  function levelOf(process) {
    const token = [null];
    if (!OpenProcessToken(process, TOKEN_QUERY, token)) return null;
    try {
      const buf = Buffer.alloc(256);
      if (!GetTokenInformation(token[0], TOKEN_INTEGRITY_LEVEL, buf, buf.length, [0])) return null;
      const sid = koffi.decode(buf, 'void *');
      const count = koffi.decode(GetSidSubAuthorityCount(sid), 'uint8_t');
      return count ? koffi.decode(GetSidSubAuthority(sid, count - 1), 'uint32_t') : null;
    } finally {
      CloseHandle(token[0]);
    }
  }

  return {
    ownLevel: () => levelOf(GetCurrentProcess()),
    processLevel(pid) {
      const process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if (!process) return null; // access denied (system, anti-cheat) or gone
      try { return levelOf(process); } finally { CloseHandle(process); }
    },
  };
}

// platform and api are injectable for the tests; api is only built (koffi loaded) on first use
function createElevation({ platform = process.platform, api = windowsApi } = {}) {
  let native; // undefined: not loaded yet; null: unavailable
  let own; // our own level, read once
  let warnOnce = once(nullLog);

  function load() {
    if (native === undefined) {
      try {
        native = platform === 'win32' ? api() : null;
      } catch (e) {
        native = null;
        warnOnce('elevation-unavailable', { error: e });
      }
    }
    return native;
  }

  const safe = (fn) => {
    try { return fn(); } catch (e) { warnOnce('elevation-failed', { error: e }); return null; }
  };

  function ownLevel() {
    if (own === undefined && load()) own = safe(() => native.ownLevel());
    return own ?? null;
  }

  // true when the app (from focus: { pid, … }) surely runs above LibreShard; null when unknown
  function above(app) {
    const pid = app && app.pid;
    if (!Number.isInteger(pid) || pid <= 0 || !load()) return null;
    const mine = ownLevel();
    const theirs = safe(() => native.processLevel(pid));
    if (mine === null || theirs === null) return null;
    return theirs > mine;
  }

  // Whether LibreShard itself runs as administrator (high level or more), for the diagnostics; null
  // when unknown
  function selfElevated() {
    const mine = ownLevel();
    return mine === null ? null : mine >= 0x3000;
  }

  const setLog = (log) => { warnOnce = once(log); };

  return { above, selfElevated, setLog };
}

module.exports = { createElevation, ...createElevation() };

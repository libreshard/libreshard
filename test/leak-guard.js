// Loaded into every test file (npm test: --require ./test/leak-guard.js). Once a file's tests are
// done its process should exit by itself; if something is still open (a server, a watcher, a timer),
// it would hang, which once kept the Windows CI job running for over 50 minutes. Instead, after a
// grace period this prints what is still open and fails the file. The timer is unref'd, so it never
// keeps a healthy process alive.
const { after } = require('node:test');

const GRACE_MS = 5000;

// The runner's own process loads this file too; only the processes that run a test file need it
// (they have NODE_TEST_CONTEXT set), and an after() hook in the runner would print an empty report
if (process.env.NODE_TEST_CONTEXT) after(() => {
  setTimeout(() => {
    const open = process.getActiveResourcesInfo().filter((r) => r !== 'TTYWrap');
    console.error(`\nleak-guard: still running ${GRACE_MS / 1000} s after the tests finished. Open: ${open.join(', ') || '(none listed)'}`);
    process.exit(1);
  }, GRACE_MS).unref();
});

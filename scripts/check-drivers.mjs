#!/usr/bin/env node
/**
 * Optional database driver report
 *
 * Database drivers are optional dependencies, so `npm ci` succeeds without a
 * usable one whenever it cannot be installed (an unsupported Node ABI, for
 * example). The suites that need a real database probe the driver and skip
 * themselves - see tests/Database/support.ts - which keeps CI green but hides
 * how much actually ran. This script runs the same probe and reports the gap as
 * a workflow warning, so a silently missing suite is still visible in a run.
 *
 * It always exits 0: an unavailable driver is a coverage gap, not a failure.
 */

const DRIVERS = [
  {
    name: 'better-sqlite3',
    // Suites guarded by WITH_BETTER_SQLITE in tests/Database/support.ts.
    suites: [
      'tests/Database/Connection.test.ts',
      'tests/Database/DrizzleAdapter.test.ts',
      'tests/Database/Query/Builder/SqliteIntegration.test.ts',
    ],
    /**
     * Opening a connection is what proves the compiled binary exists: the JS
     * wrapper imports fine without it, because the binding is only resolved
     * inside the Database constructor.
     */
    async probe() {
      const Database = await import('better-sqlite3');
      const db = new Database.default(':memory:');
      const version = db.prepare('SELECT sqlite_version() AS version').get().version;
      db.close();
      return `SQLite ${version}`;
    },
  },
];

/**
 * Escape a value for a GitHub Actions workflow command.
 */
function escapeData(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * The first line of a failure, which is the part worth reading in an
 * annotation: the rest of a native-module error is a require stack or a list of
 * probed paths, and workflow commands flatten newlines anyway.
 */
function reason(error) {
  return String(error.message ?? error)
    .split('\n', 1)[0]
    .trim();
}

/**
 * Report a driver that cannot be used, as an annotation inside Actions and as
 * a plain warning everywhere else.
 */
function warn(driver, error) {
  const text = `${driver.name} is unusable, so ${driver.suites.length} SQLite suite(s) will be skipped: ${reason(error)}`;

  if (!process.env.GITHUB_ACTIONS) {
    console.warn(`warning: ${text}`);
    return;
  }

  const file = escapeData('package.json');
  const title = escapeData(`${driver.name} unavailable`);
  console.log(`::warning file=${file},title=${title}::${escapeData(text)}`);
}

for (const driver of DRIVERS) {
  try {
    console.log(`ok   ${driver.name}: usable (${await driver.probe()})`);
  } catch (error) {
    warn(driver, error);
    console.log(`skip ${driver.name}: not usable`);
  }
}

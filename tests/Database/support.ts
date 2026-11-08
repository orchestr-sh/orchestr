/**
 * Shared helpers for the database tests.
 *
 * Database drivers are optional dependencies, and npm installs them without
 * complaint even when no usable build exists (no prebuilt binary for a new Node
 * ABI, blocked install scripts, and so on), so suites that talk to a real
 * database probe the driver instead of assuming an installed package works.
 *
 * scripts/check-drivers.mjs reports the same probe to CI, so a skipped suite
 * shows up as a warning instead of only a smaller test count; keep the two
 * probes in step when either changes.
 */

/**
 * Whether better-sqlite3 can actually open a database.
 *
 * The JS wrapper imports fine even without a compiled binary - the binding is
 * only resolved when a Database is constructed - so probing means opening a
 * real in-memory connection, not `import()`-ing the package.
 */
export async function hasBetterSqlite(): Promise<boolean> {
  try {
    const Database = await import('better-sqlite3');
    const db = new Database.default(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Flag for `describe.skipIf(!WITH_BETTER_SQLITE)`.
 */
export const WITH_BETTER_SQLITE = await hasBetterSqlite();

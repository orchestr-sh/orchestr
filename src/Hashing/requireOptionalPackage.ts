/**
 * Optional package resolution for hashing drivers
 *
 * bcrypt and argon2 are optional peer dependencies with CommonJS native
 * builds, so they are loaded synchronously through `createRequire` anchored
 * at the process working directory - the consuming application's
 * node_modules. Anchoring there (rather than import.meta.url) keeps both
 * the ESM and the CJS bundle outputs working.
 */

import { createRequire } from 'module';

export function requireOptionalPackage(name: string): unknown {
  const require = createRequire(`${process.cwd()}/orchestr-resolve.js`);

  return require(name);
}

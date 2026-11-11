/**
 * PathTraversalException
 *
 * Thrown when a disk path tries to escape its root - local adapters jail
 * every operation below the configured root and reject `..` segments with
 * this exception instead of touching the escaped location.
 */
export class PathTraversalException extends Error {
  constructor(path: string) {
    super(`Path [${path}] attempts to escape the disk root.`);
    this.name = 'PathTraversalException';
  }
}

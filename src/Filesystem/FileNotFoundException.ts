/**
 * FileNotFoundException
 *
 * Thrown when a disk cannot read a file it was asked about - the mirror of
 * Laravel's Illuminate\Contracts\Filesystem\FileNotFoundException.
 */
export class FileNotFoundException extends Error {
  constructor(path?: string, options?: ErrorOptions) {
    super(path ? `File not found at path: ${path}` : 'File not found.', options);
    this.name = 'FileNotFoundException';
  }
}

/**
 * FileUploadException
 *
 * Raised when an upload cannot be accepted or stored - a body over the
 * configured multipart limits, a missing boundary parameter, or a store
 * attempt for a file that never uploaded. Laravel throws
 * Illuminate\Http\Exceptions\FileNotFoundException on the same conditions.
 */
export class FileUploadException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileUploadException';
  }
}

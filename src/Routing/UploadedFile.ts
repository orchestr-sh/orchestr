/**
 * UploadedFile - Laravel's HTTP upload representation
 * Illuminate\Http\UploadedFile
 *
 * Carries the bytes a multipart parse buffered for one file part plus the
 * client-reported name and media type. Storing is delegated entirely to the
 * Disk contract - the class holds no filesystem logic itself (DRY) - so
 * `store()` lands on the configured disk whether that is local today or
 * S3 tomorrow.
 */

import { statSync } from 'fs';
import { readFile } from 'fs/promises';
import type { Disk, Uploadable } from '@/Filesystem/Contracts/Disk';
import type { FilesystemManager } from '@/Filesystem/FilesystemManager';
import type { ImageDimensions } from '@/Support/Mimes';
import { getGlobalApp } from '@/Support/helpers';
import { extensionOf, guessExtension, guessMimeType, imageDimensions, sniffMagicBytes } from '@/Support/Mimes';
import { Str } from '@/Support/Str';
import { FileUploadException } from './FileUploadException';

/** Upload completed successfully */
export const UPLOAD_ERR_OK = 0;

/** The upload exceeds the configured maximum file size */
export const UPLOAD_ERR_INI_SIZE = 1;

/** The upload exceeds the MAX_FILE_SIZE of the form */
export const UPLOAD_ERR_FORM_SIZE = 2;

/** The upload was only partially transferred */
export const UPLOAD_ERR_PARTIAL = 3;

/** No file was uploaded */
export const UPLOAD_ERR_NO_FILE = 4;

/** The server's temporary folder is missing */
export const UPLOAD_ERR_NO_TMP_DIR = 6;

/** Failed to write the upload to disk */
export const UPLOAD_ERR_CANT_WRITE = 7;

/** The upload was stopped by a PHP extension */
export const UPLOAD_ERR_EXTENSION = 8;

/**
 * Construction data for an upload, as the multipart parser emits it
 */
export interface UploadedFileOptions {
  /** The client-reported file name */
  name: string;
  /** The buffered bytes of the part */
  contents?: Buffer | null;
  /** Location on disk for uploads stored outside the request body */
  path?: string | null;
  /** Media type reported by the client (guessed from the name when absent) */
  mimeType?: string | null;
  /** UPLOAD_ERR_* code; defaults to a successful upload */
  error?: number;
}

/**
 * Options accepted by the store* family, mirroring Laravel's $options
 * array: 'disk' selects the disk, the rest is passed through to the driver.
 */
export interface UploadStoreOptions {
  /** Disk name to store on; omitted means the default (public for storePublicly) */
  disk?: string;
  [key: string]: any;
}

export class UploadedFile implements Uploadable {
  /**
   * The client-reported name without any path components
   */
  public readonly originalName: string;

  /**
   * The media type reported by the client
   */
  public readonly clientMimeType: string;

  /**
   * The UPLOAD_ERR_* code carried by the part
   */
  public readonly error: number;

  /**
   * Buffered bytes, or null when the upload lives at `localPath`
   */
  protected contents: Buffer | null;

  /**
   * On-disk location of the upload, when it was not buffered in memory
   */
  protected localPath: string | null;

  constructor(options: UploadedFileOptions) {
    this.originalName = baseName(String(options.name ?? ''));
    this.contents = options.contents ?? null;
    this.localPath = options.path ?? null;
    this.error = options.error ?? UPLOAD_ERR_OK;
    this.clientMimeType = options.mimeType || guessMimeType(this.originalName) || 'application/octet-stream';
  }

  /**
   * The name reported by the client
   * Laravel: $request->file('avatar')->getClientOriginalName()
   */
  getClientOriginalName(): string {
    return this.originalName;
  }

  /**
   * The extension of the client-reported name, lower-cased ('' when absent)
   * Laravel: $uploadedFile->getClientOriginalExtension()
   */
  getClientOriginalExtension(): string {
    return extensionOf(this.originalName);
  }

  /**
   * The media type reported by the client
   * Laravel: $uploadedFile->getClientMimeType()
   */
  getClientMimeType(): string {
    return this.clientMimeType;
  }

  /**
   * Upload size in bytes
   * Laravel: $uploadedFile->getSize()
   */
  getSize(): number {
    if (this.contents !== null) {
      return this.contents.byteLength;
    }

    if (this.localPath) {
      try {
        return statSync(this.localPath).size;
      } catch {
        return 0;
      }
    }

    return 0;
  }

  /**
   * The UPLOAD_ERR_* code carried by the upload
   * Laravel: $uploadedFile->getError()
   */
  getError(): number {
    return this.error;
  }

  /**
   * Determine the upload finished successfully and its bytes are available
   * Laravel: $uploadedFile->isValid()
   */
  isValid(): boolean {
    return this.error === UPLOAD_ERR_OK && (this.contents !== null || this.localPath !== null);
  }

  /**
   * The on-disk location of the upload, or null while it is only buffered
   * Laravel: $uploadedFile->getRealPath()
   */
  getRealPath(): string | null {
    return this.localPath;
  }

  /**
   * Read the upload's bytes
   */
  async get(): Promise<Buffer> {
    if (!this.isValid()) {
      throw new FileUploadException(
        `The file "${this.originalName}" did not upload successfully (error code ${this.error}).`
      );
    }

    if (this.contents !== null) {
      return this.contents;
    }

    return await readFile(this.localPath as string);
  }

  /**
   * A random 40-character name keeping the upload's extension
   * Laravel: $uploadedFile->hashName()
   */
  hashName(): string {
    const extension = this.guessClientExtension();

    return extension === '' ? Str.random(40) : `${Str.random(40)}.${extension}`;
  }

  /**
   * The extension implied by the media type the client declared, falling
   * back to the client name's extension
   * Laravel: $uploadedFile->guessClientExtension()
   */
  guessClientExtension(): string {
    return guessExtension(this.clientMimeType) || this.getClientOriginalExtension();
  }

  /**
   * The media type of the upload's bytes when a file signature matches,
   * otherwise the type the client declared - the way PHP's finfo reports
   * uploads
   * Laravel: File::getMimeType()
   */
  async detectedMimeType(): Promise<string> {
    if (!this.isValid()) {
      return this.clientMimeType;
    }

    try {
      return sniffMagicBytes(await this.get()) ?? this.clientMimeType;
    } catch {
      return this.clientMimeType;
    }
  }

  /**
   * The extension implied by the detected media type, falling back to the
   * client name's extension
   * Laravel: $uploadedFile->guessExtension()
   */
  async guessExtension(): Promise<string> {
    return guessExtension(await this.detectedMimeType()) || this.getClientOriginalExtension();
  }

  /**
   * Image width and height read from the upload's bytes, or null when the
   * content is not a recognisable raster image
   * Laravel: getimagesize($uploadedFile->getRealPath())
   */
  async dimensions(): Promise<ImageDimensions | null> {
    if (!this.isValid()) {
      return null;
    }

    try {
      return imageDimensions(await this.get());
    } catch {
      return null;
    }
  }

  /**
   * Store the file on the given disk directory under a hash-generated name
   * Laravel: $uploadedFile->store('avatars')
   */
  async store(directory = '', options: UploadStoreOptions = {}): Promise<string | false> {
    return await this.diskFor(options).putFile(directory, this, options);
  }

  /**
   * Store the file under an explicit name
   * Laravel: $uploadedFile->storeAs('avatars', 'me.png')
   */
  async storeAs(directory: string, name: string, options: UploadStoreOptions = {}): Promise<string | false> {
    return await this.diskFor(options).putFileAs(directory, this, name, options);
  }

  /**
   * Store the file on the public disk under a hash-generated name
   * Laravel: $uploadedFile->storePublicly('avatars')
   */
  async storePublicly(directory = '', options: UploadStoreOptions = {}): Promise<string | false> {
    return await this.store(directory, { ...options, disk: options.disk ?? 'public' });
  }

  /**
   * Store the file on the public disk under an explicit name
   * Laravel: $uploadedFile->storePubliclyAs('avatars', 'me.png')
   */
  async storePubliclyAs(directory: string, name: string, options: UploadStoreOptions = {}): Promise<string | false> {
    return await this.storeAs(directory, name, { ...options, disk: options.disk ?? 'public' });
  }

  /**
   * Resolve the target disk from the container-bound filesystem manager
   * Laravel: the Storage facade resolution inside UploadedFile::storeAs()
   */
  protected diskFor(options: UploadStoreOptions): Disk {
    const app = getGlobalApp();

    if (!app || !app.bound('filesystem')) {
      throw new FileUploadException(
        'Storage is not available. Register the FilesystemServiceProvider before storing uploads.'
      );
    }

    return app.make<FilesystemManager>('filesystem').disk(options.disk);
  }
}

/**
 * Determine whether a validation value is an upload from this request layer
 */
export function isUploadedFile(value: unknown): value is UploadedFile {
  return value instanceof UploadedFile;
}

/**
 * Strip path components the way Symfony's UploadedFile does, covering both
 * POSIX and Windows-style names browsers and tools may report
 */
function baseName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');

  return separator === -1 ? name : normalized.slice(separator + 1);
}

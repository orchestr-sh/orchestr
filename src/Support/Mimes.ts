/**
 * Mimes - MIME type and image inspection helpers
 *
 * Laravel leans on symfony/mime and PHP's getimagesize() here; this port
 * keeps the essentials inline so uploads can be validated without optional
 * dependencies: magic-byte sniffing, extension mapping and header-level
 * image dimension reads.
 */

/** Extensions Laravel's `image` validation rule accepts */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'];

/**
 * Image dimensions as read from a file's header bytes
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

const EXTENSION_TO_MIME: Record<string, string> = {
  aac: 'audio/aac',
  avif: 'image/avif',
  bmp: 'image/bmp',
  css: 'text/css',
  csv: 'text/csv',
  flac: 'audio/flac',
  gif: 'image/gif',
  gz: 'application/gzip',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/vnd.microsoft.icon',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  json: 'application/json',
  js: 'text/javascript',
  m4a: 'audio/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  otf: 'font/otf',
  pdf: 'application/pdf',
  png: 'image/png',
  rtf: 'application/rtf',
  svg: 'image/svg+xml',
  tar: 'application/x-tar',
  txt: 'text/plain',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  wav: 'audio/wav',
  wasm: 'application/wasm',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xml: 'application/xml',
  zip: 'application/zip',
};

/**
 * Extension best known for a media type, first mapping entry wins
 */
const MIME_TO_EXTENSION: Record<string, string> = {};

for (const [extension, type] of Object.entries(EXTENSION_TO_MIME)) {
  MIME_TO_EXTENSION[type] ??= extension;
}

/**
 * Guess a file's media type from its extension, or null when unknown
 */
export function guessMimeType(fileName: string): string | null {
  const extension = extensionOf(fileName);

  return extension ? (EXTENSION_TO_MIME[extension] ?? null) : null;
}

/**
 * Guess the extension for a media type, or null when unknown
 */
export function guessExtension(mimeType: string | null | undefined): string | null {
  if (!mimeType) {
    return null;
  }

  return MIME_TO_EXTENSION[mimeType.toLowerCase()] ?? null;
}

/**
 * Detect a file's media type from its bytes, falling back to the
 * client-reported name - the way PHP's finfo resolves types
 */
export function detectMimeType(contents: Buffer, fileName?: string): string {
  return sniffMagicBytes(contents) ?? guessMimeType(fileName ?? '') ?? 'application/octet-stream';
}

/**
 * Image width and height read from header bytes, or null when the buffer is
 * not a recognised raster image (getimagesize in PHP)
 */
export function imageDimensions(contents: Buffer): ImageDimensions | null {
  if (isPng(contents) && contents.toString('latin1', 12, 16) === 'IHDR') {
    return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) };
  }

  if (contents.byteLength >= 10 && contents.toString('latin1', 0, 4) === 'GIF8') {
    return { width: contents.readUInt16LE(6), height: contents.readUInt16LE(8) };
  }

  if (contents.byteLength >= 26 && contents.toString('latin1', 0, 2) === 'BM') {
    return { width: Math.abs(contents.readInt32LE(18)), height: Math.abs(contents.readInt32LE(22)) };
  }

  if (
    contents.byteLength >= 30 &&
    contents.toString('latin1', 0, 4) === 'RIFF' &&
    contents.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return webpDimensions(contents);
  }

  if (contents.byteLength >= 4 && contents[0] === 0xff && contents[1] === 0xd8) {
    return jpegDimensions(contents);
  }

  return null;
}

/**
 * File extension without the dot, lower-cased; '' when absent
 */
export function extensionOf(fileName: string): string {
  const name = String(fileName ?? '');
  const dot = name.lastIndexOf('.');

  return dot === -1 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Media type from magic bytes; null when no signature matches
 */
export function sniffMagicBytes(contents: Buffer): string | null {
  if (contents.byteLength < 4) {
    return null;
  }

  const head = contents.subarray(0, 16).toString('latin1');

  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff) return 'image/jpeg';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('BM')) return 'image/bmp';
  if (head.startsWith('RIFF') && contents.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head.startsWith('RIFF') && contents.toString('latin1', 8, 12) === 'AVI ') return 'video/x-msvideo';
  if (head.startsWith('\x1f\x8b')) return 'application/gzip';
  if (head.startsWith('PK\x03\x04')) return 'application/zip';
  if (head.startsWith('%PDF')) return 'application/pdf';
  if (head.startsWith('\x00\x00\x01\x00')) return 'image/x-icon';
  if (contents.byteLength >= 32) {
    const text = contents.subarray(0, 64).toString('utf-8').trimStart().toLowerCase();

    if (text.startsWith('<?xml') && text.includes('<svg')) return 'image/svg+xml';
    if (text.startsWith('<svg')) return 'image/svg+xml';
    if (text.startsWith('<!doctype html') || text.startsWith('<html')) return 'text/html';
  }

  return null;
}

function isPng(contents: Buffer): boolean {
  return contents.byteLength >= 24 && contents.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n';
}

/**
 * Walk JPEG markers until a start-of-frame segment carries dimensions
 */
function jpegDimensions(contents: Buffer): ImageDimensions | null {
  let offset = 2;

  while (offset + 9 < contents.byteLength) {
    if (contents[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = contents[offset + 1];

    // Standalone markers carry no length and cannot be skipped by segment
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      return { height: contents.readUInt16BE(offset + 5), width: contents.readUInt16BE(offset + 7) };
    }

    const segmentLength = contents.readUInt16BE(offset + 2);

    if (segmentLength < 2) {
      return null;
    }

    offset += 2 + segmentLength;
  }

  return null;
}

/**
 * WebP dimensions across the VP8X, VP8 (lossy) and VP8L (lossless) chunk
 * layouts
 */
function webpDimensions(contents: Buffer): ImageDimensions | null {
  const chunk = contents.toString('latin1', 12, 16);

  if (chunk === 'VP8X') {
    return {
      width: contents.readUIntLE(24, 3) + 1,
      height: contents.readUIntLE(27, 3) + 1,
    };
  }

  if (chunk === 'VP8 ' && contents[23] === 0x9d && contents[24] === 0x01 && contents[25] === 0x2a) {
    return {
      width: contents.readUInt16LE(26) & 0x3fff,
      height: contents.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === 'VP8L' && contents[20] === 0x21) {
    const bits = contents.readUInt32LE(21);

    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

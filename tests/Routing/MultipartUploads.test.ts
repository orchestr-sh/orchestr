import { captureResponse, createApp, createRawRequest } from '@tests/Session/support';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { describe, expect, it } from 'vitest';
import { FileUploadException } from '@/Routing/FileUploadException';
import { Request } from '@/Routing/Request';
import { UploadedFile, UPLOAD_ERR_INI_SIZE } from '@/Routing/UploadedFile';

const BOUNDARY = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

/**
 * Assemble a multipart/form-data body the way a browser frames it
 */
function multipart(
  parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>,
  boundary = BOUNDARY,
  close = true
): Buffer {
  const chunks: Buffer[] = [];

  for (const part of parts) {
    let disposition = `Content-Disposition: form-data; name="${part.name}"`;

    if (part.filename !== undefined) {
      disposition += `; filename="${part.filename}"`;
    }

    chunks.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n`));

    if (part.contentType) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }

    chunks.push(
      Buffer.from('\r\n', 'utf-8'),
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value),
      Buffer.from('\r\n')
    );
  }

  if (close) {
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
  }

  return Buffer.concat(chunks);
}

/**
 * Raw IncomingMessage carrying a prebuffered body, like the Kernel receives
 */
function rawRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: Buffer | string
): IncomingMessage {
  const req = new IncomingMessage(new Socket());

  req.method = method;
  req.url = url;
  req.headers = {};

  for (const [name, value] of Object.entries(headers)) {
    req.headers[name.toLowerCase()] = value;
  }

  if (body !== undefined) {
    req.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
  }

  req.push(null);

  return req;
}

async function requestWith(
  method: string,
  body: Buffer,
  contentType = `multipart/form-data; boundary=${BOUNDARY}`,
  options?: Parameters<Request['parseBody']>[0]
): Promise<Request> {
  const request = new Request(rawRequest(method, '/upload', { 'content-type': contentType }, body));
  await request.parseBody(options);

  return request;
}

describe('multipart/form-data parsing', () => {
  it('exposes file parts as UploadedFile instances via request.file()', async () => {
    const png = Buffer.from('\x89PNG\r\n\x1a\n', 'latin1');
    const request = await requestWith(
      'POST',
      multipart([
        { name: 'title', value: 'Holiday album' },
        { name: 'avatar', value: png, filename: 'photo.png', contentType: 'image/png' },
      ])
    );

    const file = request.file('avatar');

    expect(file).toBeInstanceOf(UploadedFile);
    expect((file as UploadedFile).getClientOriginalName()).toBe('photo.png');
    expect((file as UploadedFile).getClientMimeType()).toBe('image/png');
    expect((file as UploadedFile).getSize()).toBe(8);
    expect((file as UploadedFile).isValid()).toBe(true);
    expect(request.input('title')).toBe('Holiday album');
    expect(request.hasFile('avatar')).toBe(true);
    expect(request.hasFile('nope')).toBe(false);
  });

  it('parses DELETE bodies the same way as POST/PUT/PATCH', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const request = await requestWith(
        method,
        multipart([{ name: 'payload', value: 'x'.repeat(32), filename: 'p.txt', contentType: 'text/plain' }])
      );

      expect(request.file('payload'), method).toBeInstanceOf(UploadedFile);
      expect(request.input('nope')).toBeUndefined();
    }
  });

  it('runs multipart DELETE through the HTTP kernel', async () => {
    const { router, kernel } = createApp();

    let seen: UploadedFile | null = null;

    router.delete('/profile', (request: Request) => {
      seen = request.file('resume') as UploadedFile;

      return { deleted: true };
    });

    const { raw, chunks } = captureResponse();

    await kernel.handle(
      createRawRequest('DELETE', '/profile', {
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: multipart([
          { name: 'resume', value: 'cv bytes', filename: 'cv.txt', contentType: 'text/plain' },
        ]).toString('latin1'),
      }),
      raw
    );

    expect(seen).toBeInstanceOf(UploadedFile);
    expect((seen as UploadedFile | null)?.getClientOriginalName()).toBe('cv.txt');
    expect(raw.statusCode).toBe(200);
    expect(chunks.join('')).toContain('deleted');
  });

  it('collects repeated [] names into arrays', async () => {
    const request = await requestWith(
      'POST',
      multipart([
        { name: 'photos[]', value: 'a', filename: 'a.png', contentType: 'image/png' },
        { name: 'photos[]', value: 'b', filename: 'b.png', contentType: 'image/png' },
        { name: 'tags[]', value: 'keep' },
        { name: 'tags[]', value: 'forget' },
      ])
    );

    const photos = request.file('photos');

    expect(Array.isArray(photos)).toBe(true);
    expect((photos as UploadedFile[]).map((f) => f.getClientOriginalName())).toEqual(['a.png', 'b.png']);
    expect(request.all().tags).toEqual(['keep', 'forget']);
  });

  it('nests bracketed field names', async () => {
    const request = await requestWith('POST', multipart([{ name: 'user[first]', value: 'Ada' }]));

    expect(request.input('user')).toEqual({ first: 'Ada' });
  });

  it('preserves binary content untouched, even around boundary-lookalikes', async () => {
    const tricky = Buffer.concat([
      Buffer.from('head\r\n'),
      Buffer.from([0x00, 0x01, 0xfe, 0xff]),
      Buffer.from(`\r\n--not-the-${BOUNDARY}-here\r\n--${BOUNDARY.slice(0, 10)} tail`),
      Buffer.from([0x89, 0x50]),
    ]);

    const request = await requestWith(
      'POST',
      multipart([{ name: 'blob', value: tricky, filename: 'blob.bin', contentType: 'application/octet-stream' }])
    );

    const file = request.file('blob') as UploadedFile;

    expect(await file.get()).toEqual(tricky);
    expect(file.getSize()).toBe(tricky.byteLength);
  });

  it('accepts quoted boundaries', async () => {
    const request = await requestWith(
      'POST',
      multipart([{ name: 'doc', value: 'x', filename: 'd.txt' }]),
      `multipart/form-data; boundary="${BOUNDARY}"`
    );

    expect(request.hasFile('doc')).toBe(true);
  });

  it('skips parts with an empty filename', async () => {
    const request = await requestWith('POST', multipart([{ name: 'slot', value: '', filename: '' }]));

    expect(request.file('slot')).toBeNull();
    expect(request.all().slot).toBeUndefined();
  });

  it('marks files beyond maxFileSize as failed uploads without buffering them', async () => {
    const request = await requestWith(
      'POST',
      multipart([
        { name: 'small', value: 'ok', filename: 's.txt' },
        { name: 'big', value: Buffer.alloc(4096, 0x41), filename: 'big.bin' },
      ]),
      undefined,
      { maxFileSize: 1024 }
    );

    const big = request.file('big') as UploadedFile;
    const small = request.file('small') as UploadedFile;

    expect(small.isValid()).toBe(true);
    expect(big.getError()).toBe(UPLOAD_ERR_INI_SIZE);
    expect(big.isValid()).toBe(false);
    expect(big.getSize()).toBe(0);
    await expect(big.get()).rejects.toBeInstanceOf(FileUploadException);
  });

  it('rejects bodies above maxBodySize', async () => {
    const request = new Request(
      rawRequest(
        'POST',
        '/upload',
        { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        multipart([{ name: 'big', value: Buffer.alloc(64 * 1024, 0x42), filename: 'big.bin' }])
      )
    );

    await expect(request.parseBody({ maxBodySize: 8 * 1024 })).rejects.toBeInstanceOf(FileUploadException);
  });

  it('rejects multipart requests without a boundary parameter', async () => {
    const request = new Request(rawRequest('POST', '/upload', { 'content-type': 'multipart/form-data' }, 'whatever'));

    await expect(request.parseBody()).rejects.toThrow(/missing its boundary parameter/);
  });

  it('keeps JSON and urlencoded parsing intact', async () => {
    const json = await requestWith('POST', Buffer.from(JSON.stringify({ name: 'Ada' })), 'application/json');
    expect(json.input('name')).toBe('Ada');

    const form = await requestWith('POST', Buffer.from('name=Grace&lang=en'), 'application/x-www-form-urlencoded');
    expect(form.all()).toEqual({ name: 'Grace', lang: 'en' });
    expect(form.hasFile('name')).toBe(false);
  });

  it('allFiles and file() cover the whole bag', async () => {
    const request = await requestWith(
      'POST',
      multipart([
        { name: 'one', value: '1', filename: 'one.txt' },
        { name: 'two', value: '2', filename: 'two.txt' },
      ])
    );

    expect(Object.keys(request.allFiles())).toEqual(['one', 'two']);
    expect(Object.keys(request.file() as Record<string, UploadedFile>)).toEqual(['one', 'two']);
  });

  it('merges uploads into all() so validators see them', async () => {
    const request = await requestWith(
      'POST',
      multipart([{ name: 'avatar', value: 'img', filename: 'a.png', contentType: 'image/png' }])
    );

    const all = request.all();

    expect(all.avatar).toBeInstanceOf(UploadedFile);
  });
});

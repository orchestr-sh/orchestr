import { describe, expect, it } from 'vitest';
import type { ValidationRules } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';
import { Validator } from '@/Foundation/Http/Validator';
import { UploadedFile, UPLOAD_ERR_INI_SIZE } from '@/Routing/UploadedFile';

/**
 * Minimal PNG carrying `width` x `height` in its IHDR chunk; the parser
 * only needs the signature plus the header
 */
function png(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = Buffer.alloc(25);

  chunk.writeUInt32BE(13, 0);
  chunk.write('IHDR', 4, 'latin1');
  chunk.writeUInt32BE(width, 8);
  chunk.writeUInt32BE(height, 12);

  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

  return Buffer.concat([signature, chunk, iend]);
}

function upload(name: string, contents: Buffer, mimeType?: string): UploadedFile {
  return new UploadedFile({ name, contents, mimeType });
}

async function validate(data: Record<string, any>, rules: ValidationRules): Promise<Validator> {
  const validator = new Validator(data, rules);
  await validator.validate();

  return validator;
}

describe('upload validation rules', () => {
  it('file passes valid uploads and rejects failed ones', async () => {
    const ok = await validate(
      { avatar: upload('photo.png', png(4, 2), 'image/png') },
      { avatar: ['required', 'file'] }
    );
    expect(ok.fails()).toBe(false);

    const failed = await validate(
      { avatar: new UploadedFile({ name: 'x.png', error: UPLOAD_ERR_INI_SIZE }) },
      {
        avatar: ['required', 'file'],
      }
    );
    expect(failed.fails()).toBe(true);
    expect(failed.errors().avatar?.join(' ')).toMatch(/must be a file/);

    const notAFile = await validate({ avatar: 'just-a-string' }, { avatar: ['file'] });
    expect(notAFile.fails()).toBe(true);
  });

  it('image accepts real images and rejects other uploads', async () => {
    const image = await validate(
      { banner: upload('banner.png', png(8, 8), 'image/png') },
      { banner: ['file', 'image'] }
    );
    expect(image.fails()).toBe(false);

    const doc = await validate(
      { banner: upload('notes.txt', Buffer.from('hello'), 'text/plain') },
      {
        banner: ['image'],
      }
    );
    expect(doc.fails()).toBe(true);
    expect(doc.errors().banner?.join(' ')).toMatch(/must be an image/);
  });

  it('mimes checks the type detected from the bytes, not the spoofed name', async () => {
    const honest = await validate({ media: upload('clip.bin', png(4, 2)) }, { media: ['mimes:png'] });
    expect(honest.fails()).toBe(false);

    const wrong = await validate({ media: upload('photo.png', png(4, 2)) }, { media: ['mimes:jpg,jpeg'] });
    expect(wrong.fails()).toBe(true);
    expect(wrong.errors().media?.join(' ')).toMatch(/invalid file type/);
  });

  it('mimetypes compares full media types', async () => {
    const ok = await validate(
      { doc: upload('spec.txt', Buffer.from('plain'), 'text/plain') },
      {
        doc: ['mimetypes:text/plain,application/pdf'],
      }
    );
    expect(ok.fails()).toBe(false);

    const bad = await validate(
      { doc: upload('spec.txt', Buffer.from('plain'), 'text/plain') },
      {
        doc: ['mimetypes:image/png'],
      }
    );
    expect(bad.fails()).toBe(true);
    expect(bad.errors().doc?.join(' ')).toMatch(/invalid mimetype/);
  });

  it('max measures uploads in kilobytes', async () => {
    const small = await validate({ attachment: upload('a.bin', Buffer.alloc(512)) }, { attachment: ['max:1'] });
    expect(small.fails()).toBe(false);

    const big = await validate({ attachment: upload('a.bin', Buffer.alloc(4096)) }, { attachment: ['max:1'] });
    expect(big.fails()).toBe(true);
    expect(big.errors().attachment?.join(' ')).toMatch(/may not be greater than 1 kilobytes/);

    // min and size speak the same file language
    const tiny = await validate({ attachment: upload('a.bin', Buffer.alloc(512)) }, { attachment: ['min:1'] });
    expect(tiny.fails()).toBe(true);
    expect(tiny.errors().attachment?.join(' ')).toMatch(/at least 1 kilobytes/);
  });

  it('dimensions reads image headers for width/height limits', async () => {
    const pass = await validate(
      { logo: upload('logo.png', png(4, 2), 'image/png') },
      {
        logo: ['dimensions:width=4,height=2,min_width=2,max_width=10,min_height=1,max_height=8'],
      }
    );
    expect(pass.fails()).toBe(false);

    const tooWide = await validate(
      { logo: upload('logo.png', png(4, 2), 'image/png') },
      {
        logo: ['dimensions:max_width=3'],
      }
    );
    expect(tooWide.fails()).toBe(true);
    expect(tooWide.errors().logo?.join(' ')).toMatch(/invalid image dimensions/);

    const wrongSize = await validate(
      { logo: upload('logo.png', png(4, 2), 'image/png') },
      {
        logo: ['dimensions:width=5'],
      }
    );
    expect(wrongSize.fails()).toBe(true);
  });

  it('supports the Rule-object builders for uploads', async () => {
    const ok = await validate(
      { avatar: upload('photo.png', png(4, 2)) },
      { avatar: [Rule.file(), Rule.imageFile(), Rule.dimensions({ width: 4, height: 2 }), Rule.mimes(['png'])] }
    );
    expect(ok.fails()).toBe(false);

    const bad = await validate(
      { avatar: upload('photo.png', png(4, 2)) },
      { avatar: [Rule.file(), Rule.imageFile(), Rule.dimensions({ minWidth: 6 })] }
    );
    expect(bad.fails()).toBe(true);
    expect(bad.errors().avatar?.join(' ')).toMatch(/invalid image dimensions/);
  });

  it('keeps plain-object file validation working as before', async () => {
    const legacy = await validate(
      { avatar: { mimetype: 'image/png', size: 10, extension: 'png' } },
      { avatar: ['file', 'image', 'mimes:png', 'mimetypes:image/png'] }
    );
    expect(legacy.fails()).toBe(false);
  });

  it('validated() carries the upload instances through', async () => {
    const file = upload('photo.png', png(4, 2), 'image/png');
    const validator = await validate({ avatar: file }, { avatar: ['file'] });

    expect(validator.validated().avatar).toBe(file);
  });
});

/**
 * Attachment sources
 *
 * Buffers, filesystem paths and storage disks all resolve through one
 * renderer path (DRY): raw content wins immediately, paths are read
 * from disk, and storage paths go through the configured Disk contract.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Mailable } from '@/Mail/Mailable';
import type { MailTestApp } from './support';
import { createMailApp } from './support';

class DataMail extends Mailable {
  content(): void {
    this.html('<p>see attached</p>').attachData(Buffer.from('report bytes'), 'report.bin', {
      mime: 'application/octet-stream',
    });
  }
}

class PdfMail extends Mailable {
  content(): void {
    this.html('<p>invoice</p>').attachData('1,2,3', 'invoice.csv');
  }
}

class PathMail extends Mailable {
  constructor(public file: string) {
    super();
  }

  content(): void {
    this.text('attached').attach(this.file);
  }
}

class StorageMail extends Mailable {
  content(): void {
    this.text('attached').attachFromStorage('files/notes.txt');
  }
}

class StorageDiskMail extends Mailable {
  content(): void {
    this.text('attached').attachFromStorageDisk('public', 'files/logo.png', 'Logo.png');
  }
}

class InlineMail extends Mailable {
  content(): void {
    this.html('<img src="cid:badge">').attachData('img', 'badge.png', { inline: true, cid: 'badge' });
  }
}

describe('attachments', () => {
  let test: MailTestApp;

  beforeEach(async () => {
    test = await createMailApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('attaches a buffer with explicit metadata', async () => {
    await test.manager.send(new DataMail());

    const [message] = test.sentThrough();

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe('report.bin');
    expect(message.attachments[0].content.toString()).toBe('report bytes');
    expect(message.attachments[0].contentType).toBe('application/octet-stream');
  });

  it('attaches string data and guesses the media type', async () => {
    await test.manager.send(new PdfMail());

    const [attachment] = test.sentThrough()[0].attachments;

    expect(attachment.content.toString()).toBe('1,2,3');
    expect(attachment.contentType).toBe('text/csv');
  });

  it('attaches a file from the local filesystem', async () => {
    const file = join(test.base, 'quarterly.txt');

    writeFileSync(file, 'numbers', 'utf-8');

    await test.manager.send(new PathMail(file));

    const [message] = test.sentThrough();

    expect(message.attachments[0].filename).toBe('quarterly.txt');
    expect(message.attachments[0].content.toString()).toBe('numbers');
  });

  it('fails with FileNotFoundException for a missing path', async () => {
    await expect(test.manager.send(new PathMail(join(test.base, 'nope.txt')))).rejects.toThrow(/nope\.txt/);
  });

  it('attaches a file from the configured storage disk', async () => {
    mkdirSync(join(test.storageRoot, 'files'), { recursive: true });
    writeFileSync(join(test.storageRoot, 'files', 'notes.txt'), 'from storage', 'utf-8');

    await test.manager.send(new StorageMail());

    const [message] = test.sentThrough();

    expect(message.attachments[0].filename).toBe('notes.txt');
    expect(message.attachments[0].content.toString()).toBe('from storage');
    expect(message.attachments[0].contentType).toBe('text/plain');
  });

  it('attaches from an explicitly named disk under a custom name', async () => {
    mkdirSync(join(test.storageRoot, 'public/files'), { recursive: true });
    writeFileSync(join(test.storageRoot, 'public/files', 'logo.png'), Buffer.from([0x89, 0x50]), 'utf-8');

    await test.manager.send(new StorageDiskMail());

    const [message] = test.sentThrough();

    expect(message.attachments[0].filename).toBe('Logo.png');
    expect(message.attachments[0].contentType).toBe('image/png');
  });

  it('reports a missing storage file as not found', async () => {
    await expect(test.manager.send(new StorageMail())).rejects.toThrow(/files\/notes\.txt/);
  });

  it('keeps inline metadata for embedded images', async () => {
    await test.manager.send(new InlineMail());

    const [attachment] = test.sentThrough()[0].attachments;

    expect(attachment.inline).toBe(true);
    expect(attachment.cid).toBe('badge');
  });
});

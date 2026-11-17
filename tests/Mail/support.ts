/**
 * Shared helpers for the Mail test suites: a booted application with the
 * view, filesystem, queue and mail providers registered against a
 * throwaway base path, plus a temp views directory the `view` binding
 * renders from.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { FilesystemServiceProvider } from '@/Filesystem/FilesystemServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { MailManager } from '@/Mail/MailManager';
import { MailServiceProvider } from '@/Mail/MailServiceProvider';
import { ArrayTransport } from '@/Mail/Transports/ArrayTransport';
import { QueueServiceProvider } from '@/Queue/QueueServiceProvider';
import { Facade } from '@/Support/Facade';
import { ViewServiceProvider } from '@/View/ViewServiceProvider';

let counter = 0;

export interface MailTestApp {
  app: Application;
  config: Config;
  /** The booted MailManager, resolved from the container. */
  manager: MailManager;
  /** Root of the temporary application directory. */
  base: string;
  viewsDir: string;
  storageRoot: string;
  /** Write a view file (dot names create directories). */
  putView(name: string, content: string): void;
  /** The messages recorded by an array transport mailer. */
  sentThrough(name?: string): MailMessageRecords;
  cleanup(): Promise<void>;
}

export type MailMessageRecords = ArrayTransport['messages'];

export interface MailTestOptions {
  /** Values layered over the default `mail` config section. */
  mail?: Record<string, any>;
  /** Values layered over the default `filesystems` config section. */
  filesystems?: Record<string, any>;
  /** Extra top-level config keys. */
  config?: Record<string, any>;
}

export async function createMailApp(options: MailTestOptions = {}): Promise<MailTestApp> {
  const base = join(tmpdir(), `orchestr-mail-tests-${process.pid}-${Date.now()}-${counter++}`);
  const viewsDir = join(base, 'resources/views');
  const storageRoot = join(base, 'storage/app');
  mkdirSync(viewsDir, { recursive: true });
  mkdirSync(storageRoot, { recursive: true });

  const config = new Config({
    app: { name: 'Mail Test' },
    view: { paths: [viewsDir], cache: false },
    filesystems: {
      default: 'local',
      disks: {
        local: { driver: 'local', root: storageRoot },
        public: { driver: 'local', root: join(storageRoot, 'public'), url: '/storage' },
      },
      ...options.filesystems,
    },
    queue: { default: 'sync', connections: { sync: { driver: 'sync' } } },
    mail: {
      default: 'array',
      from: { address: 'mail@test.orchestr', name: 'Mail Test' },
      mailers: {
        array: { transport: 'array' },
        log: { transport: 'log' },
      },
      attachments: { disk: 'local' },
      ...options.mail,
    },
    ...options.config,
  });

  const app = new Application(base);
  app.instance('config', config);

  Facade.setFacadeApplication(app);
  Facade.clearResolvedInstances();

  app.register(ViewServiceProvider);
  app.register(FilesystemServiceProvider);
  app.register(QueueServiceProvider);
  app.register(MailServiceProvider);

  await app.boot();

  const manager = app.make<MailManager>('mailer');

  return {
    app,
    config,
    manager,
    base,
    viewsDir,
    storageRoot,
    putView(name: string, content: string): void {
      const file = join(viewsDir, name.replace(/\./g, '/') + '.html');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
    },
    sentThrough(name = 'array'): MailMessageRecords {
      const transport = manager.transport(name) as ArrayTransport;

      return transport.messages;
    },
    async cleanup(): Promise<void> {
      Facade.clearResolvedInstances();
      Facade.setFacadeApplication(undefined as unknown as Application);
      rmSync(base, { recursive: true, force: true });
    },
  };
}

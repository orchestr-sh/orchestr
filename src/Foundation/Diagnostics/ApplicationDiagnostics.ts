/**
 * ApplicationDiagnostics
 *
 * Collects the report behind `orchestr about`: framework version,
 * environment, and the drivers / configuration of every subsystem the
 * application actually registered. Managers (cache, queue, database,
 * session, filesystem) are asked directly when they are bound; otherwise the
 * values are read from the config repository, so the report works even
 * before those services boot.
 *
 * SRP: this is the only place that knows *what* the about report contains;
 * the command only formats the sections it is handed.
 */

import type { CacheManager } from '@/Cache/CacheManager';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { FilesystemManager } from '@/Filesystem/FilesystemManager';
import type { QueueManager } from '@/Queue/QueueManager';
import type { SessionManager } from '@/Session/SessionManager';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';

export type AboutRow = [label: string, value: string];

export interface AboutSection {
  title: string;
  rows: AboutRow[];
}

/** Placeholder for "this application does not have that configured". */
const UNSET = '—';

export class ApplicationDiagnostics {
  constructor(private app: Application) {}

  /**
   * Build the ordered sections of the about report.
   */
  collect(): AboutSection[] {
    return [
      this.environmentSection(),
      this.driversSection(),
      this.cacheSection(),
      this.databaseSection(),
      this.queueSection(),
      this.filesystemSection(),
      this.sessionSection(),
    ];
  }

  // ------------------------------------------------------------- sections

  protected environmentSection(): AboutSection {
    return {
      title: 'Environment',
      rows: [
        ['Orchestr', this.app.version()],
        ['Node', process.version],
        ['Environment', this.app.environment()],
        ['Debug Mode', this.app.isDebug() ? 'ENABLED' : 'DISABLED'],
        ['Base Path', this.app.getBasePath()],
        ['Application URL', this.configValue('app.url') ?? UNSET],
      ],
    };
  }

  protected driversSection(): AboutSection {
    return {
      title: 'Drivers',
      rows: [
        ['Cache', this.cacheManager()?.getDefaultDriver() ?? this.configValue('cache.default') ?? UNSET],
        ['Database', this.databaseManager()?.getDefaultConnection() ?? this.configValue('database.default') ?? UNSET],
        [
          'Filesystem',
          this.filesystemManager()?.getDefaultDriver() ?? this.configValue('filesystems.default') ?? UNSET,
        ],
        ['Queue', this.queueManager()?.getDefaultConnection() ?? this.configValue('queue.default') ?? UNSET],
        ['Session', this.sessionManager()?.getDefaultDriver() ?? this.configValue('session.driver') ?? UNSET],
      ],
    };
  }

  protected cacheSection(): AboutSection {
    const manager = this.cacheManager();

    const rows: AboutRow[] = manager
      ? [
          ['Default Store', manager.getDefaultDriver()],
          ['Stores', describeNamed(manager.getStoreNames(), (name) => manager.getStoreConfig(name).driver ?? UNSET)],
          ['Key Prefix', manager.getPrefix()],
        ]
      : [
          ['Default Store', this.configValue('cache.default') ?? UNSET],
          ['Stores', listConfigured(this.configRaw('cache.stores'), 'driver')],
          ['Key Prefix', this.configValue('cache.prefix') ?? UNSET],
        ];

    return { title: 'Cache', rows };
  }

  protected databaseSection(): AboutSection {
    const manager = this.databaseManager();

    let rows: AboutRow[];

    if (manager) {
      const config = manager.getConfig();
      rows = [
        ['Default Connection', manager.getDefaultConnection()],
        ['Connections', describeNamed(manager.getConnections(), (name) => config.connections[name]?.driver ?? UNSET)],
      ];
    } else {
      rows = [
        ['Default Connection', this.configValue('database.default') ?? UNSET],
        ['Connections', listConfigured(this.configRaw('database.connections'), 'driver')],
      ];
    }

    return { title: 'Database', rows };
  }

  protected queueSection(): AboutSection {
    const manager = this.queueManager();

    let rows: AboutRow[];

    if (manager) {
      const config = manager.getConfig();
      rows = [
        ['Default Connection', manager.getDefaultConnection()],
        ['Connections', describeNamed(manager.getConnections(), (name) => config.connections[name]?.driver ?? UNSET)],
        [
          'Batching',
          config.batching ? `database: ${config.batching.database}, table: ${config.batching.table}` : UNSET,
        ],
      ];
    } else {
      rows = [
        ['Default Connection', this.configValue('queue.default') ?? UNSET],
        ['Connections', listConfigured(this.configRaw('queue.connections'), 'driver')],
      ];
    }

    return { title: 'Queue', rows };
  }

  protected filesystemSection(): AboutSection {
    const manager = this.filesystemManager();

    const rows: AboutRow[] = manager
      ? [
          ['Default Disk', manager.getDefaultDriver()],
          ['Disks', describeNamed(manager.getDiskNames(), (name) => manager.config.disks[name]?.driver ?? UNSET)],
        ]
      : [
          ['Default Disk', this.configValue('filesystems.default') ?? UNSET],
          ['Disks', listConfigured(this.configRaw('filesystems.disks'), 'driver')],
        ];

    return { title: 'Filesystem', rows };
  }

  protected sessionSection(): AboutSection {
    const manager = this.sessionManager();

    const rows: AboutRow[] = [
      ['Driver', manager ? manager.getDefaultDriver() : (this.configValue('session.driver') ?? UNSET)],
      ['Lifetime (minutes)', String(manager?.config.lifetime ?? this.configValue('session.lifetime') ?? UNSET)],
      ['Cookie', String(manager?.config.cookie ?? this.configValue('session.cookie') ?? UNSET)],
      [
        'Expire On Close',
        String(manager?.config.expire_on_close ?? this.configValue('session.expire_on_close') ?? UNSET),
      ],
    ];

    return { title: 'Session', rows };
  }

  // ----------------------------------------------------------- resolution

  /**
   * A bound service, or null when the subsystem was never registered.
   */
  protected bound<T>(name: string): T | null {
    try {
      return this.app.bound(name) ? this.app.make<T>(name) : null;
    } catch {
      return null;
    }
  }

  protected cacheManager(): CacheManager | null {
    return this.bound<CacheManager>('cache');
  }

  protected databaseManager(): DatabaseManager | null {
    return this.bound<DatabaseManager>('db');
  }

  protected filesystemManager(): FilesystemManager | null {
    return this.bound<FilesystemManager>('filesystem');
  }

  protected queueManager(): QueueManager | null {
    return this.bound<QueueManager>('queue');
  }

  protected sessionManager(): SessionManager | null {
    return this.bound<SessionManager>('session');
  }

  /**
   * Read one dot-path from the config repository as a raw value (objects
   * included), for sections that walk a whole config subtree.
   */
  protected configRaw(key: string): unknown {
    const config = this.bound<Config>('config');

    return config ? config.get(key) : undefined;
  }

  /**
   * Read one dot-path from the config repository as a display string;
   * non-scalars read as undefined so sections fall back to their subtrees.
   */
  protected configValue(key: string): string | undefined {
    const value = this.configRaw(key);

    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined;
  }
}

/**
 * Render `name (driver)` pairs for a list of configured names.
 */
function describeNamed(names: string[], driverOf: (name: string) => string): string {
  if (names.length === 0) {
    return UNSET;
  }

  return names.map((name) => `${name} (${driverOf(name)})`).join(', ');
}

/**
 * Same rendering for a raw config object keyed by name, used when the
 * manager is not registered and only the config repository is available.
 */
function listConfigured(entries: unknown, driverKey: string): string {
  if (entries === null || typeof entries !== 'object') {
    return UNSET;
  }

  const names = Object.keys(entries as Record<string, unknown>);

  return describeNamed(names, (name) => {
    const entry = (entries as Record<string, any>)[name];
    const driver = entry && typeof entry === 'object' ? entry[driverKey] : undefined;

    return driver === undefined ? UNSET : String(driver);
  });
}

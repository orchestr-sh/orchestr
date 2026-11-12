/**
 * Event discovery + cache end-to-end tests
 *
 * Verifies the loop Laravel promises: scan a Listeners directory, map
 * listeners to their event classes via metadata, register them on boot,
 * persist the mapping through `event:cache` (versioned cache format), boot a
 * fresh application straight from the cache, list everything through
 * `event:list`, and reset with `event:clear`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCacheCommand } from '@/Console/Commands/EventCacheCommand';
import { EventClearCommand } from '@/Console/Commands/EventClearCommand';
import { EventListCommand } from '@/Console/Commands/EventListCommand';
import { Dispatcher } from '@/Events/Dispatcher';
import { Event } from '@/Events/Event';
import { EventDiscoveryCache } from '@/Events/EventDiscoveryCache';
import { EventServiceProvider } from '@/Events/EventServiceProvider';
import { clearListenerRegistry } from '@/Events/ListenerRegistry';
import { Application } from '@/Foundation/Application';
import { EventDiscovery } from '@/Support/EventDiscovery';

/** Application base whose `path('Listeners')` lands on the fixture folder */
const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');
/** Discovery path pinned for the temp-workspace applications */
const FIXTURE_LISTENERS_DIR = join(FIXTURES_DIR, 'app/Listeners');

/** Event named exactly like the fixture listener's metadata type hint */
class OrderShipped extends Event {
  constructor(public readonly orderId: number) {
    super();
  }
}

class TestEventServiceProvider extends EventServiceProvider {
  protected listen: Record<string, string | string[]> = {};
}

/** Application with the discovery path pinned to the in-repo fixture folder */
class FixtureApp extends Application {
  getEventDiscoveryPaths(): string[] {
    return [FIXTURE_LISTENERS_DIR];
  }
}

const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((call: any[]) => String(call[0])).join('\n');

async function bootProvider(app: Application): Promise<TestEventServiceProvider> {
  const provider = new TestEventServiceProvider(app);
  provider.register();
  await provider.boot();
  return provider;
}

describe('Event discovery and caching', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearListenerRegistry();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('EventDiscovery', () => {
    it('discovers listener classes and their event types from a real directory', async () => {
      const app = new Application(FIXTURES_DIR);
      const discovery = new EventDiscovery(app);

      const listeners = await discovery.discover(app.getEventDiscoveryPaths());

      expect(listeners.get('OrderShipped')).toEqual(['Listeners/ShipOrderNotification']);
      expect(discovery.getDiscoveredClasses().get('Listeners/ShipOrderNotification')).toBeDefined();
    });

    it('skips missing directories without failing', async () => {
      const app = new Application('/test');
      const discovery = new EventDiscovery(app);

      const listeners = await discovery.discover(['/definitely/not/here']);

      expect(listeners.size).toBe(0);
    });
  });

  describe('EventServiceProvider discovery', () => {
    it('registers discovered listeners and dispatches to them on boot', async () => {
      const app = new Application(FIXTURES_DIR);
      await bootProvider(app);

      const events = app.make<Dispatcher>('events');

      expect(events.hasListeners('OrderShipped')).toBe(true);

      const responses = await events.dispatch(new OrderShipped(5));

      expect(responses).toEqual(['sent:5']);
    });
  });

  describe('event:cache / event:clear commands', () => {
    let workspace: string;

    beforeEach(() => {
      workspace = mkdtempSync(join(tmpdir(), 'orchestr-events-'));
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    it('caches discovered listeners, boots from the cache, and clears it', async () => {
      const app = new FixtureApp(workspace);
      const cache = new EventDiscoveryCache(app);

      // event:cache writes the versioned cache file
      await new EventCacheCommand(app).handle();

      expect(cache.exists()).toBe(true);
      const raw = JSON.parse(readFileSync(cache.getCachePath(), 'utf-8'));
      expect(raw.version).toBe('1.0');
      expect(raw.events.OrderShipped.listeners).toHaveLength(1);
      expect(String(raw.events.OrderShipped.listeners[0])).toMatch(/Listeners\/ShipOrderNotification$/);

      // A fresh application boots straight from the cache without rescanning
      const freshApp = new FixtureApp(workspace);
      const discoverSpy = vi.spyOn(EventDiscovery.prototype, 'discover');

      await bootProvider(freshApp);

      expect(discoverSpy).not.toHaveBeenCalled();

      const events = freshApp.make<Dispatcher>('events');
      expect(events.hasListeners('OrderShipped')).toBe(true);
      await expect(events.dispatch(new OrderShipped(9))).resolves.toEqual(['sent:9']);

      // event:list reflects the cached listener mapping
      logSpy.mockClear();
      await new EventListCommand(freshApp).handle([], {});
      const listed = logged(logSpy);
      expect(listed).toContain('OrderShipped');
      expect(listed).toContain('ShipOrderNotification');

      // event:clear removes the file so the next boot rediscovers
      await new EventClearCommand(app).handle();
      expect(cache.exists()).toBe(false);
      expect(existsSync(app.storagePath('framework/events.json'))).toBe(false);
    });

    it('reports when there is nothing to cache or clear', async () => {
      const emptyApp = new FixtureApp(join(workspace, 'empty'));
      (emptyApp as any).getEventDiscoveryPaths = () => [join(workspace, 'missing-listeners')];

      await new EventCacheCommand(emptyApp).handle();
      expect(logged(warnSpy)).toContain('No events discovered');

      await new EventClearCommand(emptyApp).handle();
      expect(logged(logSpy)).toContain('No cached events found');
    });
  });
});

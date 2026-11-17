/**
 * TestCase - the vitest-style wiring
 *
 * When a test case declares no `test*` methods, constructing it registers
 * beforeEach/afterEach for the whole file: ordinary vitest `it` blocks can
 * call the fluent helpers directly, and the application is rebuilt between
 * tests all the same.
 */

import { describe, it, expect } from 'vitest';
import { Router } from '@/Routing/Router';
import { TestCase } from '@/Testing';

class ManualTestCase extends TestCase {
  protected defineRoutes(router: Router): void {
    router.get('/', (_req, res) => res.header('Content-Type', 'text/plain').send('manual mode'));
    router.get('/stamp', (_req, res) => res.json({ stamp: this.constructor.name }));
  }
}

const test = new ManualTestCase();

let seenApp: unknown = null;

describe('vitest-style usage', () => {
  it('boots lazily from the first helper call', async () => {
    (await test.get('/')).assertOk().assertSee('manual mode');

    expect(test.app.isBooted()).toBe(true);
  });

  it('rebuilds the application between tests', async () => {
    expect(test.app).not.toBe(seenApp);

    seenApp = test.app;

    (await test.get('/stamp')).assertJsonPath('stamp', 'ManualTestCase');
  });

  it('exposes the test client for direct use', async () => {
    const response = await test.client.get('/');

    response.assertOk();
    expect(response.header('Content-Type')).toContain('text/plain');
  });
});

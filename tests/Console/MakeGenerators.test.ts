/**
 * Generator commands - shared contract tests
 *
 * Table-driven coverage for the remaining `make:*` generators. Every case
 * asserts the same contract the ticket demands: correct destination from
 * the project's path mapping, the derived namespace, the class/symbol
 * name, the framework imports, refusal to overwrite existing files, and
 * `--force` replacing them. The per-flag specifics live in each generator's
 * own test file where they need it (model, policy, resource, factory,
 * request).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CommandOptions } from '@/Console/Command';
import { MakeCastCommand } from '@/Console/Commands/MakeCastCommand';
import { MakeChannelCommand } from '@/Console/Commands/MakeChannelCommand';
import { MakeClassCommand } from '@/Console/Commands/MakeClassCommand';
import { MakeCommandCommand } from '@/Console/Commands/MakeCommandCommand';
import { MakeEnumCommand } from '@/Console/Commands/MakeEnumCommand';
import { MakeExceptionCommand } from '@/Console/Commands/MakeExceptionCommand';
import { MakeInterfaceCommand } from '@/Console/Commands/MakeInterfaceCommand';
import { MakeMailCommand } from '@/Console/Commands/MakeMailCommand';
import { MakeMiddlewareCommand } from '@/Console/Commands/MakeMiddlewareCommand';
import { MakeNotificationCommand } from '@/Console/Commands/MakeNotificationCommand';
import { MakeObserverCommand } from '@/Console/Commands/MakeObserverCommand';
import { MakeProviderCommand } from '@/Console/Commands/MakeProviderCommand';
import { MakeRuleCommand } from '@/Console/Commands/MakeRuleCommand';
import { MakeSeederCommand } from '@/Console/Commands/MakeSeederCommand';
import { MakeTestCommand } from '@/Console/Commands/MakeTestCommand';
import { MakeTraitCommand } from '@/Console/Commands/MakeTraitCommand';
import { GeneratorCommand } from '@/Console/Generators/GeneratorCommand';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { Application } from '@/Foundation/Application';

interface GeneratorCase {
  /** Shown in the test name. */
  title: string;
  /** Fresh command instance for a given app. */
  build: (app: Application) => GeneratorCommand;
  /** Positional name passed to handle(). */
  name: string;
  /** Options passed to handle(). */
  options?: CommandOptions;
  /** File path below the application root. */
  file: string[];
  /** Snippets the generated file must contain. */
  contains: string[];
}

const cases: GeneratorCase[] = [
  {
    title: 'make:middleware',
    build: (app) => new MakeMiddlewareCommand(app),
    name: 'CheckToken',
    file: ['app/Http/Middleware/CheckToken.ts'],
    contains: [
      'Namespace: App\\Http\\Middleware',
      "import type { Middleware } from '@orchestr-sh/orchestr'",
      'export const CheckToken: Middleware = async (request, response, next) => {',
      'await next();',
    ],
  },
  {
    title: 'make:provider',
    build: (app) => new MakeProviderCommand(app),
    name: 'AppServiceProvider',
    file: ['app/Providers/AppServiceProvider.ts'],
    contains: [
      'Namespace: App\\Providers',
      "import { ServiceProvider } from '@orchestr-sh/orchestr'",
      'export class AppServiceProvider extends ServiceProvider',
      'register(): void {',
      'boot(): void {',
    ],
  },
  {
    title: 'make:observer (unbound falls back to Ensemble)',
    build: (app) => new MakeObserverCommand(app),
    name: 'PostObserver',
    file: ['app/Observers/PostObserver.ts'],
    contains: [
      'Namespace: App\\Observers',
      "import { Ensemble } from '@orchestr-sh/orchestr'",
      'export class PostObserver {',
      'created(model: Ensemble): void {',
      'forceDeleted(model: Ensemble): void {',
    ],
  },
  {
    title: 'make:observer --model=Post binds the model',
    build: (app) => new MakeObserverCommand(app),
    name: 'PostObserver',
    options: { model: 'Post' },
    file: ['app/Observers/PostObserver.ts'],
    contains: ["import { Post } from '../Models/Post'", 'created(model: Post): void {'],
  },
  {
    title: 'make:rule',
    build: (app) => new MakeRuleCommand(app),
    name: 'HasPrefix',
    file: ['app/Rules/HasPrefix.ts'],
    contains: [
      'Namespace: App\\Rules',
      "import type { ValidationRuleObject } from '@orchestr-sh/orchestr'",
      'export class HasPrefix implements ValidationRuleObject',
      "rule = 'has_prefix'",
      'passes(attribute: string, value: any, context?: any): boolean | Promise<boolean> {',
      'messageFor(attribute: string, value: any, context?: any): string | undefined {',
    ],
  },
  {
    title: 'make:command derives a colon signature',
    build: (app) => new MakeCommandCommand(app),
    name: 'SendPodcastLogs',
    file: ['app/Console/Commands/SendPodcastLogs.ts'],
    contains: [
      'Namespace: App\\Console\\Commands',
      "import { Command } from '@orchestr-sh/orchestr'",
      "import type { CommandOptions } from '@orchestr-sh/orchestr'",
      'export class SendPodcastLogs extends Command',
      "signature = 'send:podcast-logs'",
      'async handle(args: string[], options: CommandOptions): Promise<void> {',
    ],
  },
  {
    title: 'make:command --command= overrides the signature',
    build: (app) => new MakeCommandCommand(app),
    name: 'Cleanup',
    options: { command: 'logs:cleanup' },
    file: ['app/Console/Commands/Cleanup.ts'],
    contains: ["signature = 'logs:cleanup'"],
  },
  {
    title: 'make:test lands in tests/Feature by default',
    build: (app) => new MakeTestCommand(app),
    name: 'ExampleTest',
    file: ['tests/Feature/ExampleTest.test.ts'],
    contains: [
      'Namespace: Tests\\Feature',
      "import { describe, expect, it } from 'vitest'",
      "describe('ExampleTest'",
      "it('is true'",
    ],
  },
  {
    title: 'make:test --unit uses tests/Unit',
    build: (app) => new MakeTestCommand(app),
    name: 'NumberTest',
    options: { unit: true },
    file: ['tests/Unit/NumberTest.test.ts'],
    contains: ['Namespace: Tests\\Unit'],
  },
  {
    title: 'make:mail',
    build: (app) => new MakeMailCommand(app),
    name: 'OrderShipped',
    file: ['app/Mail/OrderShipped.ts'],
    contains: [
      'Namespace: App\\Mail',
      "import { view } from '@orchestr-sh/orchestr'",
      "import type { View } from '@orchestr-sh/orchestr'",
      'export class OrderShipped {',
      "public subject = 'Order Shipped'",
      "return view('mail.order-shipped', {",
    ],
  },
  {
    title: 'make:notification',
    build: (app) => new MakeNotificationCommand(app),
    name: 'WelcomeNewUser',
    file: ['app/Notifications/WelcomeNewUser.ts'],
    contains: [
      'Namespace: App\\Notifications',
      'export class WelcomeNewUser {',
      "public subject = 'Welcome New User'",
      'via(notifiable: any): string[] {',
      'return [',
    ],
  },
  {
    title: 'make:cast',
    build: (app) => new MakeCastCommand(app),
    name: 'AsEncrypted',
    file: ['app/Casts/AsEncrypted.ts'],
    contains: [
      'Namespace: App\\Casts',
      'export class AsEncrypted {',
      'get(model: any, key: string, value: any, attributes: Record<string, any>): any {',
      'set(model: any, key: string, value: any, attributes: Record<string, any>): any {',
    ],
  },
  {
    title: 'make:channel',
    build: (app) => new MakeChannelCommand(app),
    name: 'OrderChannel',
    file: ['app/Broadcasting/OrderChannel.ts'],
    contains: [
      'Namespace: App\\Broadcasting',
      'export class OrderChannel {',
      "public static channelName = 'order'",
      'authenticate(user: any, ...args: string[]): boolean {',
    ],
  },
  {
    title: 'make:exception',
    build: (app) => new MakeExceptionCommand(app),
    name: 'PaymentFailedException',
    file: ['app/Exceptions/PaymentFailedException.ts'],
    contains: [
      'Namespace: App\\Exceptions',
      'export class PaymentFailedException extends Error {',
      "constructor(message: string = 'Payment Failed', options?: ErrorOptions) {",
      "this.name = 'PaymentFailedException'",
    ],
  },
  {
    title: 'make:enum',
    build: (app) => new MakeEnumCommand(app),
    name: 'Status',
    file: ['app/Enums/Status.ts'],
    contains: ['Namespace: App\\Enums', 'export enum Status {'],
  },
  {
    title: 'make:interface',
    build: (app) => new MakeInterfaceCommand(app),
    name: 'HasOwner',
    file: ['app/Contracts/HasOwner.ts'],
    contains: ['Namespace: App\\Contracts', 'export interface HasOwner {'],
  },
  {
    title: 'make:trait (TS mixin)',
    build: (app) => new MakeTraitCommand(app),
    name: 'HasSlug',
    file: ['app/Traits/HasSlug.ts'],
    contains: [
      'Namespace: App\\Traits',
      'export function HasSlug(Base: abstract new (...args: any[]) => any = class {}) {',
      'abstract class HasSlugMixin extends Base {',
      'return HasSlugMixin;',
    ],
  },
  {
    title: 'make:class sits at the app root',
    build: (app) => new MakeClassCommand(app),
    name: 'ReportExporter',
    file: ['app/ReportExporter.ts'],
    contains: ['Namespace: App', 'export class ReportExporter {'],
  },
  {
    title: 'make:class carries subdirectories',
    build: (app) => new MakeClassCommand(app),
    name: 'Services/ReportExporter',
    file: ['app/Services/ReportExporter.ts'],
    contains: ['Namespace: App\\Services', 'export class ReportExporter {'],
  },
  {
    title: 'make:seeder uses the database/seeders mapping',
    build: (app) => new MakeSeederCommand(app),
    name: 'UserSeeder',
    file: ['database/seeders/UserSeeder.ts'],
    contains: [
      'Namespace: Database\\Seeders',
      "import { Seeder } from '@orchestr-sh/orchestr'",
      'export default class UserSeeder extends Seeder {',
      'async run(): Promise<void> {',
    ],
  },
];

describe('make:* generators', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-generators-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(basePath, { recursive: true });
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  function buildCase(testCase: GeneratorCase): { command: GeneratorCommand; filePath: string } {
    const app = new Application(basePath);
    const command = testCase.build(app);

    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));

    return { command, filePath: join(basePath, ...testCase.file) };
  }

  for (const testCase of cases) {
    describe(testCase.title, () => {
      it('writes the expected file, namespace, name, and imports', async () => {
        const { command, filePath } = buildCase(testCase);

        await command.handle([testCase.name], testCase.options ?? {});

        expect(existsSync(filePath)).toBe(true);

        const content = readFileSync(filePath, 'utf-8');

        for (const snippet of testCase.contains) {
          expect(content).toContain(snippet);
        }
      });

      it('refuses to overwrite without --force and replaces with --force', async () => {
        const { command, filePath } = buildCase(testCase);

        await command.handle([testCase.name], testCase.options ?? {});
        writeFileSync(filePath, '// hand-written');

        await command.handle([testCase.name], testCase.options ?? {});
        expect(readFileSync(filePath, 'utf-8')).toBe('// hand-written');

        await command.handle([testCase.name], { ...testCase.options, force: true });
        expect(readFileSync(filePath, 'utf-8')).not.toBe('// hand-written');
        expect(readFileSync(filePath, 'utf-8')).toContain(testCase.contains[0]);
      });

      it('has a Laravel-style signature and a description', () => {
        const { command } = buildCase(testCase);

        expect(command.signature).toContain('{name}');
        expect(command.signature).toContain('{--force}');
        expect(command.description.length).toBeGreaterThan(0);
      });
    });
  }
});

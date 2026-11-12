import { existsSync } from 'fs';
import { Container } from '@/Container/Container';
import { setGlobalApp } from '@/Support/helpers';
import { Str } from '@/Support/Str';
import { ConfigServiceProvider } from './Config/ConfigServiceProvider';
import { Env } from './Env/Env';
import { packageVersion } from './PackageVersion';
import { ServiceProvider } from './ServiceProvider';

/**
 * Application class - Laravel's Illuminate\Foundation\Application
 * The heart of the framework, bootstraps everything
 */
export class Application extends Container {
  private basePath: string;
  private booted: boolean = false;
  private bootstrapped: boolean = false;
  private environmentFileName: string = '.env';
  private runningInConsoleMode: boolean | null = null;
  private serviceProviders: ServiceProvider[] = [];
  private loadedProviders: Map<string, boolean> = new Map();
  private eventDiscoveryPaths: string[] = [];

  /**
   * Bootstrappers run once, before any service provider boots. Loading the
   * environment first mirrors Laravel's `LoadEnvironmentVariables` step so
   * `APP_ENV`, `APP_DEBUG`, and `APP_KEY` are available everywhere after.
   */
  private bootstrappers: Array<(app: Application) => void> = [(app) => app.loadEnvironmentVariables()];

  constructor(basePath: string = process.cwd()) {
    super();
    this.basePath = basePath;
    this.registerBaseBindings();
    this.registerCoreContainerAliases();

    // Set this as the global app instance for helper functions
    setGlobalApp(this);

    // Bootstrapping the environment is synchronous and side-effect-light, so
    // doing it in the constructor keeps `environment()`/`isDebug()` accurate
    // even for apps that never call `boot()` (CLI tools, programmatic use).
    this.bootstrap();
  }

  /**
   * Register the basic bindings into the container
   */
  private registerBaseBindings(): void {
    this.instance('app', this);
    this.instance(Application, this);
    this.instance(Container, this);
  }

  /**
   * Register core container aliases
   */
  private registerCoreContainerAliases(): void {
    const aliases: { [key: string]: string[] } = {
      app: ['Application'],
    };

    for (const [key, aliasList] of Object.entries(aliases)) {
      for (const alias of aliasList) {
        this.alias(key, alias);
      }
    }
  }

  /**
   * Get the base path of the application
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Set the base path for the application
   */
  setBasePath(basePath: string): this {
    this.basePath = basePath;
    return this;
  }

  /**
   * Get the path to various application directories
   */
  path(path: string = ''): string {
    return `${this.basePath}/app${path ? '/' + path : ''}`;
  }

  configPath(path: string = ''): string {
    return `${this.basePath}/config${path ? '/' + path : ''}`;
  }

  databasePath(path: string = ''): string {
    return `${this.basePath}/database${path ? '/' + path : ''}`;
  }

  storagePath(path: string = ''): string {
    return `${this.basePath}/storage${path ? '/' + path : ''}`;
  }

  publicPath(path: string = ''): string {
    return `${this.basePath}/public${path ? '/' + path : ''}`;
  }

  /**
   * Get the path to the bootstrap directory (cache files, etc.)
   */
  bootstrapPath(path: string = ''): string {
    return `${this.basePath}/bootstrap${path ? '/' + path : ''}`;
  }

  /**
   * Get the path where the cached configuration snapshot lives. The
   * `APP_CONFIG_CACHE` environment variable points at an explicit snapshot;
   * otherwise the conventional `bootstrap/cache/config.json` is used.
   */
  getCachedConfigPath(): string {
    const fromEnv = Env.get('APP_CONFIG_CACHE');

    return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : this.bootstrapPath('cache/config.json');
  }

  /**
   * Determine if a configuration cache file exists
   */
  configurationIsCached(): boolean {
    return existsSync(this.getCachedConfigPath());
  }

  /**
   * Register a service provider with the application
   * Laravel: $app->register(provider)
   */
  register(provider: ServiceProvider | (new (app: Application) => ServiceProvider)): ServiceProvider {
    // If provider is a class, instantiate it
    if (typeof provider === 'function') {
      provider = new provider(this);
    }

    // Check if already registered
    const providerName = provider.constructor.name;
    if (this.loadedProviders.has(providerName)) {
      return provider;
    }

    // Call the provider's register method
    provider.register();

    this.serviceProviders.push(provider);
    this.loadedProviders.set(providerName, true);

    // If the application has already booted, boot the provider
    if (this.booted) {
      this.bootProvider(provider);
    }

    return provider;
  }

  /**
   * Register multiple service providers
   */
  registerProviders(providers: Array<ServiceProvider | (new (app: Application) => ServiceProvider)>): void {
    providers.forEach((provider) => this.register(provider));
  }

  /**
   * Boot the application's service providers
   */
  async boot(): Promise<void> {
    if (this.booted) {
      return;
    }

    this.bootstrap();

    // The configuration provider boots the config repository from files (or
    // its cached snapshot), so it must run before every other provider.
    // Applications that did not register one get it prepended here.
    if (!this.loadedProviders.has(ConfigServiceProvider.name)) {
      const configProvider = new ConfigServiceProvider(this);
      configProvider.register();
      this.serviceProviders.unshift(configProvider);
      this.loadedProviders.set(ConfigServiceProvider.name, true);
    }

    for (const provider of this.serviceProviders) {
      await this.bootProvider(provider);
    }

    this.booted = true;
  }

  /**
   * Boot the given service provider
   */
  private async bootProvider(provider: ServiceProvider): Promise<void> {
    if (typeof provider.boot === 'function') {
      const result = this.call<any>(provider.boot.bind(provider));
      if (result instanceof Promise) {
        await result;
      }
    }
  }

  /**
   * Determine if the application has booted
   */
  isBooted(): boolean {
    return this.booted;
  }

  /**
   * Run the application bootstrappers (load the environment, ...)
   * Laravel: $app->bootstrap()
   */
  bootstrap(): void {
    if (this.bootstrapped) {
      return;
    }

    for (const bootstrapper of this.bootstrappers) {
      bootstrapper(this);
    }

    this.bootstrapped = true;
  }

  /**
   * Register a terminating callback
   * Laravel: $app->terminating(callback)
   */
  private terminatingCallbacks: Array<() => void> = [];

  terminating(callback: () => void): void {
    this.terminatingCallbacks.push(callback);
  }

  /**
   * Terminate the application
   */
  terminate(): void {
    this.terminatingCallbacks.forEach((callback) => callback());
  }

  /**
   * Get the version number of the application
   */
  version(): string {
    return packageVersion();
  }

  /**
   * Determine if the application is running in the console.
   *
   * `process.argv` is defined in every Node process, so the entry script's
   * presence alone proves nothing. We instead look for command arguments
   * after the script (a CLI invocation such as `node orchestr.mjs migrate`),
   * which a bare `node server.mjs` HTTP entry never produces; the console
   * kernel additionally marks the mode explicitly for certainty.
   */
  runningInConsole(): boolean {
    if (this.runningInConsoleMode === null) {
      this.runningInConsoleMode = this.detectRunningInConsole();
    }

    return this.runningInConsoleMode;
  }

  /**
   * Explicitly declare whether the application is running in the console
   */
  setRunningInConsole(running: boolean): this {
    this.runningInConsoleMode = running;
    return this;
  }

  /**
   * Detect console execution from the process arguments
   */
  private detectRunningInConsole(): boolean {
    return Array.isArray(process.argv) && process.argv.length > 2;
  }

  /**
   * Get the environment file the application is using
   */
  environmentFile(): string {
    return this.environmentFileName;
  }

  /**
   * Set the environment file the application should load
   */
  setEnvironmentFile(file: string): this {
    this.environmentFileName = file;
    return this;
  }

  /**
   * Get the environment the application is running in, or compare the current
   * environment against the given names (wildcards allowed, like Str::is).
   * Laravel: $app->environment() / $app->environment('local', 'testing')
   *
   * `APP_ENV` takes precedence over `NODE_ENV`; production is the default.
   */
  environment(): string;
  environment(...names: string[]): boolean;
  environment(...names: string[]): string | boolean {
    const current = this.currentEnvironment();

    if (names.length === 0) {
      return current;
    }

    return names.some((pattern) => Str.is(pattern, current));
  }

  /**
   * Resolve the current environment name
   */
  private currentEnvironment(): string {
    const current = Env.get('APP_ENV') || Env.get('NODE_ENV');

    return typeof current === 'string' && current !== '' ? current : 'production';
  }

  /**
   * Load `.env` and, when an environment is selected, `.env.{APP_ENV}` into
   * the environment. Existing process environment variables win; the more
   * specific file wins over the generic one (both non-destructive defaults).
   */
  private loadEnvironmentVariables(): void {
    const basePath = `${this.basePath}/${this.environmentFile()}`;

    Env.load(basePath);

    const specific = `${basePath}.${this.currentEnvironment()}`;

    if (specific !== basePath) {
      Env.load(specific);
    }
  }

  /**
   * Determine if the application is running locally
   */
  isLocal(): boolean {
    return this.environment() === 'local';
  }

  /**
   * Determine if the application is running in production
   */
  isProduction(): boolean {
    return this.environment() === 'production';
  }

  /**
   * Determine if the application is running in testing mode
   */
  isTesting(): boolean {
    return this.environment() === 'testing';
  }

  /**
   * Determine if the application is in debug mode.
   * Laravel: `APP_DEBUG=true`
   */
  isDebug(): boolean {
    const debug = Env.get('APP_DEBUG', false);

    return debug === true || debug === '1';
  }

  /**
   * Get the service providers that have been loaded
   */
  getProviders(): ServiceProvider[] {
    return this.serviceProviders;
  }

  /**
   * Determine if the application has been bootstrapped before
   */
  hasBeenBootstrapped(): boolean {
    return this.bootstrapped;
  }

  /**
   * Configure event discovery paths
   *
   * Allows customizing which directories should be scanned for event listeners
   * during automatic discovery.
   *
   * @param {Object} options - Configuration options
   * @param {string[]} options.discover - Array of directory paths to scan for listeners
   * @returns {this} The application instance for chaining
   *
   * @example
   * ```typescript
   * app.withEvents({
   *   discover: [
   *     app.path('Listeners'),
   *     app.path('Domain/Listeners')
   *   ]
   * })
   * ```
   */
  withEvents(options: { discover?: string[] } = {}): this {
    if (options.discover) {
      this.eventDiscoveryPaths = options.discover;
    }
    return this;
  }

  /**
   * Get the event discovery paths
   *
   * Returns the configured paths for event listener discovery.
   * If no paths are configured, defaults to the 'Listeners' directory.
   *
   * @returns {string[]} Array of absolute directory paths
   */
  getEventDiscoveryPaths(): string[] {
    return this.eventDiscoveryPaths.length > 0 ? this.eventDiscoveryPaths : [this.path('Listeners')];
  }
}

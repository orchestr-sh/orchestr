import { Container } from '../Container/Container';
import { ServiceProvider } from './ServiceProvider';
import { setGlobalApp } from '../Support/helpers';

/**
 * Application class - Laravel's Illuminate\Foundation\Application
 * The heart of the framework, bootstraps everything
 */
export class Application extends Container {
  private basePath: string;
  private booted: boolean = false;
  private serviceProviders: ServiceProvider[] = [];
  private loadedProviders: Map<string, boolean> = new Map();

  constructor(basePath: string = process.cwd()) {
    super();
    this.basePath = basePath;
    this.registerBaseBindings();
    this.registerCoreContainerAliases();

    // Set this as the global app instance for helper functions
    setGlobalApp(this);
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
      const result = this.call(provider.boot.bind(provider));
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
    return '0.1.0';
  }

  /**
   * Determine if the application is running in the console
   */
  runningInConsole(): boolean {
    return process.argv[1] !== undefined;
  }

  /**
   * Get the environment file the application is using
   */
  environmentFile(): string {
    return '.env';
  }

  /**
   * Get the environment the application is running in
   */
  environment(): string {
    return process.env.NODE_ENV || 'production';
  }

  /**
   * Determine if the application is in debug mode
   */
  isDebug(): boolean {
    return process.env.DEBUG === 'true';
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
    return this.booted;
  }
}

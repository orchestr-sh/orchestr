/**
 * DatabaseManager Class
 *
 * Manages multiple database connections
 */

import { Connection } from './Connection';
import { DatabaseAdapter, DatabaseConfig } from './Contracts/DatabaseAdapter';

export interface DatabaseConnectionConfig extends DatabaseConfig {
  adapter: string;
}

export interface DatabaseManagerConfig {
  default: string;
  connections: Record<string, DatabaseConnectionConfig>;
}

export class DatabaseManager {
  protected connections: Map<string, Connection> = new Map();
  protected adapterFactories: Map<string, (config: DatabaseConfig) => DatabaseAdapter> = new Map();

  constructor(protected config: DatabaseManagerConfig) {}

  /**
   * Register an adapter factory
   */
  registerAdapter(name: string, factory: (config: DatabaseConfig) => DatabaseAdapter): void {
    this.adapterFactories.set(name, factory);
  }

  /**
   * Get a database connection
   */
  connection(name?: string): Connection {
    const connectionName = name || this.config.default;

    // Return existing connection if available
    if (this.connections.has(connectionName)) {
      return this.connections.get(connectionName)!;
    }

    // Create new connection
    const connection = this.createConnection(connectionName);
    this.connections.set(connectionName, connection);

    return connection;
  }

  /**
   * Create a new connection
   */
  protected createConnection(name: string): Connection {
    const config = this.config.connections[name];

    if (!config) {
      throw new Error(`Database connection [${name}] not configured.`);
    }

    const adapterFactory = this.adapterFactories.get(config.adapter);

    if (!adapterFactory) {
      throw new Error(`Database adapter [${config.adapter}] not registered.`);
    }

    const adapter = adapterFactory(config);
    return new Connection(adapter, config);
  }

  /**
   * Disconnect a connection
   */
  async disconnect(name?: string): Promise<void> {
    const connectionName = name || this.config.default;
    const connection = this.connections.get(connectionName);

    if (connection) {
      await connection.disconnect();
      this.connections.delete(connectionName);
    }
  }

  /**
   * Disconnect all connections
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((name) => this.disconnect(name));
    await Promise.all(promises);
  }

  /**
   * Purge a connection (disconnect and remove from cache)
   */
  async purge(name?: string): Promise<void> {
    await this.disconnect(name);
  }

  /**
   * Get the default connection name
   */
  getDefaultConnection(): string {
    return this.config.default;
  }

  /**
   * Set the default connection name
   */
  setDefaultConnection(name: string): void {
    this.config.default = name;
  }

  /**
   * Get all connection names
   */
  getConnections(): string[] {
    return Object.keys(this.config.connections);
  }

  /**
   * Get the full configuration
   * Laravel: Manager::getConfig()
   */
  getConfig(): DatabaseManagerConfig {
    return this.config;
  }

  /**
   * Extend the database manager with a macro
   */
  extend(name: string, resolver: () => any): void {
    (this as any)[name] = resolver;
  }
}

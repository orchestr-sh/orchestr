/**
 * Seeder
 *
 * Base class for all database seeders
 */

import { Connection } from '@/Database/Connection';

export abstract class Seeder {
  /**
   * The database connection
   */
  protected connection?: Connection;

  /**
   * Set the database connection
   */
  setConnection(connection: Connection): this {
    this.connection = connection;
    return this;
  }

  /**
   * Run the database seeds
   */
  abstract run(): Promise<void>;

  /**
   * Call another seeder
   */
  protected async call(seederClass: new () => Seeder): Promise<void> {
    const seeder = new seederClass();

    if (this.connection) {
      seeder.setConnection(this.connection);
    }

    await seeder.run();
  }

  /**
   * Call multiple seeders
   */
  protected async callMany(seederClasses: (new () => Seeder)[]): Promise<void> {
    for (const seederClass of seederClasses) {
      await this.call(seederClass);
    }
  }
}

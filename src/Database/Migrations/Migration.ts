/**
 * Migration
 *
 * Base class for all database migrations
 */

import { Schema } from '@/Database/Contracts/Schema';

export abstract class Migration {
  /**
   * Run the migrations
   */
  abstract up(schema: Schema): Promise<void>;

  /**
   * Reverse the migrations
   */
  abstract down(schema: Schema): Promise<void>;
}

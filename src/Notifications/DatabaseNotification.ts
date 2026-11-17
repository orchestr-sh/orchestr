/**
 * DatabaseNotification - the notifications table record
 *
 * Mirrors Illuminate\Notifications\DatabaseNotification: the row stored by
 * the database channel, linked to its recipient through the polymorphic
 * `notifiable` relation. The primary key is a UUID generated on creation
 * (Laravel does this through the HasUuids trait).
 *
 * @example
 * ```typescript
 * const rows = await user.notifications().getResults();
 *
 * for (const row of rows) {
 *   console.log(row.getAttribute('type'), row.getAttribute('data'));
 *   await row.markAsRead();
 * }
 * ```
 */

import { randomUUID } from 'crypto';
import { Ensemble } from '@/Database/Ensemble/Ensemble';

export class DatabaseNotification extends Ensemble {
  /**
   * The table associated with the model
   */
  protected table: string = 'notifications';

  /**
   * The primary key for the model
   */
  protected primaryKey: string = 'id';

  /**
   * The data type of the primary key
   */
  protected keyType: string = 'string';

  /**
   * Indicates if the IDs are auto-incrementing - they are UUIDs instead
   */
  protected incrementing: boolean = false;

  /**
   * Mass-assignable columns. The morph columns are written by the relation
   * itself through setAttribute.
   */
  static fillable: string[] = ['id', 'type', 'notifiable_type', 'notifiable_id', 'data', 'read_at'];

  /**
   * Casts: the data column round-trips through JSON, read_at is a date
   * (null while the notification is unread).
   */
  static casts: Record<string, string> = { data: 'array', read_at: 'datetime' };

  constructor(attributes: Record<string, any> = {}, fromDatabase: boolean = false) {
    // New records carry a UUID the way Laravel's HasUuids generates one;
    // rows hydrated from the database keep the id they arrived with.
    super(fromDatabase ? attributes : { id: randomUUID(), ...attributes }, fromDatabase);
  }

  /**
   * The notifiable model this notification belongs to
   * Laravel: DatabaseNotification::notifiable()
   */
  notifiable(): any {
    return (this as any).morphTo('notifiable');
  }

  /**
   * Serialize payloads on write
   *
   * Laravel does this through the `array` cast on save; this port keeps
   * casts read-side only, so the mutator is the seam: the column always
   * holds a JSON string, and `getAttribute('data')` parses it back.
   */
  setDataAttribute(value: any): void {
    const stored =
      value === null || value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value);

    (this as any).attributes.data = stored;
  }

  /**
   * Mark the notification as read
   * Laravel: DatabaseNotification::markAsRead()
   */
  async markAsRead(): Promise<boolean> {
    if (this.isRead()) {
      return true;
    }

    this.setAttribute('read_at', new Date());

    return this.save();
  }

  /**
   * Mark the notification as unread
   * Laravel: DatabaseNotification::markAsUnread()
   */
  async markAsUnread(): Promise<boolean> {
    if (this.isUnread()) {
      return true;
    }

    this.setAttribute('read_at', null);

    return this.save();
  }

  /**
   * Determine if the notification has been read
   */
  isRead(): boolean {
    return this.getAttribute('read_at') !== null && this.getAttribute('read_at') !== undefined;
  }

  /**
   * Determine if the notification is still unread
   * Laravel: DatabaseNotification::isUnread()
   */
  isUnread(): boolean {
    return !this.isRead();
  }

  /**
   * Query only the unread notifications
   * Laravel: the `unread` query scope
   */
  static unread<T extends DatabaseNotification>(this: { new (): T }): any {
    return (this as any).query().whereNull('read_at');
  }

  /**
   * Query only the read notifications
   * Laravel: the `read` query scope
   */
  static read<T extends DatabaseNotification>(this: { new (): T }): any {
    return (this as any).query().whereNotNull('read_at');
  }
}

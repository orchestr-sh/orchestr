/**
 * Model event exports
 *
 * Every lifecycle event that Ensemble fires must be reachable from the
 * package entry point - the soft-delete, restore and force-delete events
 * were historically missing from src/index.ts while only the sub-barrel
 * exported them.
 */

import { describe, it, expect } from 'vitest';
import {
  ModelEvent,
  ModelSoftDeleting,
  ModelSoftDeleted,
  ModelRestoring,
  ModelRestored,
  ModelForceDeleting,
  ModelForceDeleted,
} from '@/index';

describe('model event exports', () => {
  it('exports the soft-delete, restore and force-delete events from the main entry', () => {
    for (const eventClass of [
      ModelSoftDeleting,
      ModelSoftDeleted,
      ModelRestoring,
      ModelRestored,
      ModelForceDeleting,
      ModelForceDeleted,
    ]) {
      expect(typeof eventClass).toBe('function');
      expect(eventClass.prototype).toBeInstanceOf(ModelEvent);
    }
  });
});

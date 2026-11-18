/**
 * Ensemble Casts
 *
 * The cast registry and every built-in cast in one place: loading this
 * module installs the built-ins, and `Ensemble` resolves all casts - its own
 * switch included - through `CastRegistry`, so a new cast is a class plus a
 * registration, never an edit to the model (OCP, DRY).
 *
 * Laravel: Illuminate\Database\Eloquent\Casts namespace +
 * HasAttributes::castAttributeAs... dispatch
 */

import { AsArrayObject } from './AsArrayObject';
import { AsCollection } from './AsCollection';
import { AsEncryptedCollection } from './AsEncryptedCollection';
import { AsEnumCollection } from './AsEnumCollection';
import { AsStringable } from './AsStringable';
import { CastRegistry } from './CastRegistry';
import { DateCast } from './DateCast';
import { DecimalCast } from './DecimalCast';
import { EncryptedCast } from './EncryptedCast';
import { EnumCast } from './EnumCast';
import { HashedCast } from './HashedCast';
import { JsonCast } from './JsonCast';
import { BoolCast, FloatCast, IntCast, StringCast } from './ScalarCasts';

export { ArrayObject } from './ArrayObject';
export { AsArrayObject } from './AsArrayObject';
export { AsCollection } from './AsCollection';
export { AsEncryptedCollection } from './AsEncryptedCollection';
export { AsEnumCollection } from './AsEnumCollection';
export { AsStringable } from './AsStringable';
export { Attribute } from './Attribute';
export type { AttributeGetCallback, AttributeOptions, AttributeSetCallback } from './Attribute';
export { CastRegistry } from './CastRegistry';
export type { CastArgumentsForm, CastClass, CastDefinition, CastFactory, EnumLike } from './CastRegistry';
export { DateCast, ImmutableDate } from './DateCast';
export type { DateCastKind } from './DateCast';
export { DecimalCast } from './DecimalCast';
export { EncryptedCast } from './EncryptedCast';
export { EnumCast, enumMemberValues, resolveEnumMember } from './EnumCast';
export { HashedCast } from './HashedCast';
export { JsonCast } from './JsonCast';
export { BoolCast, FloatCast, IntCast, StringCast } from './ScalarCasts';
export { valuesEqual } from './valuesEqual';
export { formatDate } from './PhpDate';

/**
 * The built-in casts, registered by the names a casts map uses. The scalar
 * and JSON entries keep the behaviour Ensemble's old switch had, so
 * hydration, reads and persistence all resolve to one object per name.
 */
CastRegistry.register('int', () => new IntCast());
CastRegistry.register('integer', () => new IntCast());
CastRegistry.register('real', () => new FloatCast());
CastRegistry.register('float', () => new FloatCast());
CastRegistry.register('double', () => new FloatCast());
CastRegistry.register('string', () => new StringCast());
CastRegistry.register('bool', () => new BoolCast());
CastRegistry.register('boolean', () => new BoolCast());

CastRegistry.register('array', () => new JsonCast());
CastRegistry.register('json', () => new JsonCast());
CastRegistry.register('object', () => new JsonCast());

// `collection` is the string form Laravel maps onto AsCollection.
CastRegistry.register('collection', () => new AsCollection());

CastRegistry.register('date', (args: any[]) => new DateCast('date', args[0]));
CastRegistry.register('datetime', (args: any[]) => new DateCast('datetime', args[0]));
CastRegistry.register('immutable_date', (args: any[]) => new DateCast('date', args[0], true));
CastRegistry.register('immutable_datetime', (args: any[]) => new DateCast('datetime', args[0], true));
CastRegistry.register('timestamp', (args: any[]) => new DateCast('timestamp', args[0]));

CastRegistry.register('decimal', (args: any[]) => new DecimalCast(args[0] === undefined ? 2 : Number(args[0])));
CastRegistry.register('enum', (args: any[]) => new EnumCast(CastRegistry.requireEnum(String(args[0]))));

CastRegistry.register('encrypted', () => new EncryptedCast());
CastRegistry.register('hashed', () => new HashedCast());

CastRegistry.register('AsCollection', AsCollection);
CastRegistry.register('AsArrayObject', AsArrayObject);
CastRegistry.register('AsStringable', AsStringable);
CastRegistry.register('AsEncryptedCollection', AsEncryptedCollection);
CastRegistry.register(
  'AsEnumCollection',
  (args: any[]) => new AsEnumCollection(CastRegistry.requireEnum(String(args[0])))
);

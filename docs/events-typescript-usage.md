# Events TypeScript Usage Guide

## Problem: TypeScript doesn't recognize static dispatch methods

When you create an event class that extends `Event`, TypeScript may not automatically recognize the static `dispatch()`, `dispatchIf()`, `dispatchUnless()`, and `until()` methods that are added by the Dispatchable mixin.

```typescript
import { Event } from '@orchestr-sh/orchestr';

class UserRegistered extends Event {
  constructor(public user: User) {
    super();
  }
}

// TypeScript error: Property 'dispatch' does not exist on type 'typeof UserRegistered'
await UserRegistered.dispatch(user);
```

## Solution 1: Use type assertion (Quick Fix)

The simplest solution is to cast your event class to the `EventClass` type:

```typescript
import { Event, type EventClass } from '@orchestr-sh/orchestr';

class UserRegistered extends Event {
  constructor(public user: User) {
    super();
  }
}

// Cast to EventClass to get proper typing
const UserRegisteredEvent = UserRegistered as EventClass<UserRegistered>;

// Now TypeScript recognizes the static methods (all async)
await UserRegisteredEvent.dispatch(user);
await UserRegisteredEvent.dispatchIf(condition, user);
await UserRegisteredEvent.dispatchUnless(condition, user);
const result = await UserRegisteredEvent.until(user);
```

## Solution 2: Use Event facade (Recommended)

The recommended approach is to use the Event facade for dispatching. You can import it in two ways:

**Option A: Subpath import (cleaner)**
```typescript
import { Event } from '@orchestr-sh/orchestr/Facades';

class UserRegistered extends Event {
  constructor(public user: User) {
    super();
  }
}

// Dispatch through the facade - fully typed
await Event.dispatch(new UserRegistered(user));
await Event.dispatchIf(condition, new UserRegistered(user));
await Event.dispatchUnless(condition, new UserRegistered(user));
await Event.until(new UserRegistered(user));
```

**Option B: Named import from main package**
```typescript
import { EventFacade } from '@orchestr-sh/orchestr';

// Use EventFacade to avoid naming conflict with Event base class
await EventFacade.dispatch(new UserRegistered(user));
```

## Solution 3: Export with proper typing

Export your event classes with the proper type in your event files:

```typescript
// UserRegistered.ts
import { Event, type EventClass } from '@orchestr-sh/orchestr';

class UserRegisteredClass extends Event {
  constructor(public user: User) {
    super();
  }
}

// Export with proper typing
export const UserRegistered = UserRegisteredClass as EventClass<UserRegisteredClass>;
export type UserRegistered = InstanceType<typeof UserRegistered>;
```

Then use it elsewhere:

```typescript
import { UserRegistered } from './Events/UserRegistered';

// Full TypeScript support
await UserRegistered.dispatch(user);
await UserRegistered.dispatchIf(condition, user);
```

## Why This Happens

The static methods (`dispatch`, `dispatchIf`, etc.) are added to the Event class at runtime by the `applyDispatchable()` function, which uses JavaScript's `Object.defineProperty`. TypeScript's type system doesn't automatically detect these runtime-added methods.

The `EventClass<T>` type helper provides the correct type information to TypeScript, telling it that these static methods exist on your event class.

## Best Practice Recommendation

For most use cases, we recommend **Solution 2** (using the Event facade):

```typescript
await Event.dispatch(new UserRegistered(user));
```

This approach:
- ✅ Has full TypeScript support out of the box
- ✅ Is more explicit and easier to understand
- ✅ Works consistently across all event classes
- ✅ Follows Laravel's recommended pattern
- ✅ Makes testing easier (Event.fake() works seamlessly)

Reserve the static class methods for cases where you want the syntactic sugar:

```typescript
await UserRegistered.dispatch(user);  // Shorter, but requires type casting
```

> Note: `dispatch()` and `until()` are async. `dispatch()` resolves after every
> listener (including async listeners and model-event halting checks) has run,
> so always `await` them when the result or side ordering matters.

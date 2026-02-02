/**
 * Injectable Decorator
 *
 * Marks a class as injectable, enabling TypeScript to emit decorator metadata
 * required for automatic dependency injection via reflect-metadata.
 *
 * This decorator does nothing at runtime - it only triggers TypeScript's
 * emitDecoratorMetadata feature to include parameter type information.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UserController extends Controller {
 *   constructor(private userService: UserService) {
 *     super();
 *   }
 * }
 * ```
 */
export function Injectable(): ClassDecorator {
  return (target: Function) => {
    // This decorator is intentionally empty.
    // Its sole purpose is to trigger TypeScript's emitDecoratorMetadata
    // feature, which adds reflection metadata to the class constructor.
  };
}

/**
 * Action Decorator
 *
 * Marks a controller method as a route action and enables automatic parameter
 * resolution: implicit route model binding, controller dependency injection,
 * and route parameters by name.
 *
 * This decorator does nothing at runtime - its purpose is to trigger
 * TypeScript's emitDecoratorMetadata feature so the method's
 * `design:paramtypes` are reflected, exactly like `@ValidateRequest()`
 * does for FormRequest injection.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UserController extends Controller {
 *   @Action()
 *   async show(request: Request, user: User) {
 *     return user.toObject();
 *   }
 * }
 *
 * Route.get('/users/:user', [UserController, 'show']);
 * ```
 */
export function Action(): MethodDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // This decorator is intentionally empty.
    // Its sole purpose is to trigger TypeScript's emitDecoratorMetadata
    // feature, which adds reflection metadata about method parameters.
  };
}

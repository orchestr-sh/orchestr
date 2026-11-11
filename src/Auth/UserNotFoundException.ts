/**
 * UserNotFoundException - thrown when loginUsingId() cannot find a user for
 * the given authentication identifier
 * Laravel: Illuminate\Auth\UserNotFoundException
 */
export class UserNotFoundException extends Error {
  constructor(message: string = 'A user could not be found for the given authentication identifier.') {
    super(message);
    this.name = 'UserNotFoundException';

    Object.setPrototypeOf(this, UserNotFoundException.prototype);
  }
}

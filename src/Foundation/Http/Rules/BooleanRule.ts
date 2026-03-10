import { BaseRule } from './Base';

export class BooleanRule extends BaseRule {
  constructor() {
    super('boolean');
    this.invokable = true;
  }
  passes(_attribute: string, value: any): boolean {
    return (
      value === undefined ||
      typeof value === 'boolean' ||
      value === 'true' ||
      value === 'false' ||
      value === 1 ||
      value === 0
    );
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be true or false.`;
  }
}

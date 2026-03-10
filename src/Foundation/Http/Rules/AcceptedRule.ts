import { BaseRule } from './Base';

export class AcceptedRule extends BaseRule {
  constructor() {
    super('accepted');
    this.invokable = true;
  }
  passes(_attribute: string, value: any): boolean {
    const acceptedValues = ['yes', 'on', '1', 1, true, 'true'];
    return acceptedValues.includes(value);
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be accepted.`;
  }
}

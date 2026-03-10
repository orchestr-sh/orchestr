import { BaseRule } from './Base';

export class DeclinedRule extends BaseRule {
  constructor() {
    super('declined');
    this.invokable = true;
  }
  passes(_attribute: string, value: any): boolean {
    const declinedValues = ['no', 'off', '0', 0, false, 'false'];
    return declinedValues.includes(value);
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be declined.`;
  }
}

import { BaseRule } from './Base';

export class DeclinedIfRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`declined_if:${field}:${String(value)}`);
    this.invokable = true;
  }
  passes(_attribute: string, val: any, ctx: any): boolean {
    const [_, field, expected] = this.rule.split(':');
    const ov = ctx.other(field);
    if (String(ov) === expected) {
      const declinedValues = ['no', 'off', '0', 0, false, 'false'];
      return declinedValues.includes(val);
    }
    return true;
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be declined.`;
  }
}

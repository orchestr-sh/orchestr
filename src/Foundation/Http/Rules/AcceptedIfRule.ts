import { BaseRule } from './Base';

export class AcceptedIfRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`accepted_if:${field}:${String(value)}`);
    this.invokable = true;
  }
  passes(_attribute: string, val: any, ctx: any): boolean {
    const [_, field, expected] = this.rule.split(':');
    const ov = ctx.other(field);
    if (String(ov) === expected) {
      const acceptedValues = ['yes', 'on', '1', 1, true, 'true'];
      return acceptedValues.includes(val);
    }
    return true;
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be accepted.`;
  }
}

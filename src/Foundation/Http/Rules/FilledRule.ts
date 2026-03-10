import { BaseRule } from './Base';

export class FilledRule extends BaseRule {
  constructor() {
    super('filled');
    this.invokable = true;
  }
  passes(_attribute: string, value: any, ctx: any): boolean {
    return !ctx.helpers.isPresent(value) || !ctx.helpers.isEmpty(value);
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must have a value.`;
  }
}

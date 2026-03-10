import { BaseRule } from './Base';

export class PresentRule extends BaseRule {
  constructor() {
    super('present');
    this.invokable = true;
  }
  passes(_attribute: string, value: any, ctx: any): boolean {
    return ctx.helpers.isPresent(value);
  }
  messageFor(attribute: string): string {
    return `The ${attribute} field must be present.`;
  }
}

import { BaseRule } from './Base';

export class ConfirmedRule extends BaseRule {
  constructor() {
    super('confirmed');
    this.invokable = true;
  }
  passes(_attribute: string, value: any, ctx: any): boolean {
    const confirmationValue = ctx.other(`${ctx.field}_confirmation`);
    return value === confirmationValue;
  }
}

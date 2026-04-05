import { Validator } from '../Validator';
import { BaseRule, type ValidationRuleObject } from './Base';

export class AnyOfRule extends BaseRule {
  private inner: Array<string | ValidationRuleObject>;
  constructor(rules: Array<string | ValidationRuleObject>) {
    super('any_of');
    this.invokable = true;
    this.inner = rules;
  }
  async passes(_attribute: string, value: any, ctx: any): Promise<boolean> {
    const data = { [ctx.field]: value };
    for (const r of this.inner) {
      const v = new Validator(data, { [ctx.field]: [r] });
      if (await v.validate()) {
        return true;
      }
    }
    return false;
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must satisfy at least one rule.`;
  }
}

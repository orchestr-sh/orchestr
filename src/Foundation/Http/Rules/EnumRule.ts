import { BaseRule } from './Base';

export class EnumRule extends BaseRule {
  private values: Array<string | number | boolean>;
  constructor(values: Array<string | number | boolean>) {
    super('enum');
    this.invokable = true;
    this.values = values.map((v) => (typeof v === 'string' ? v : String(v)));
  }
  passes(_attribute: string, value: any): boolean {
    const v = typeof value === 'string' ? value : String(value);
    return this.values.includes(v);
  }
  messageFor(attribute: string): string {
    return `The selected ${attribute} is invalid.`;
  }
}

import { BaseRule } from './Base';

export class ContainsRule extends BaseRule {
  private needle: string;
  constructor(needle: string) {
    super(`contains:${needle}`);
    this.invokable = true;
    this.needle = needle;
  }
  passes(_attribute: string, value: any): boolean {
    const s = typeof value === 'string' ? value : String(value ?? '');
    return s.includes(this.needle);
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must contain "${this.needle}".`;
  }
}

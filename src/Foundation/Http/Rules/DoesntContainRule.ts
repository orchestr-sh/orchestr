import { BaseRule } from './Base';

export class DoesntContainRule extends BaseRule {
  private needle: string;
  constructor(needle: string) {
    super(`doesnt_contain:${needle}`);
    this.invokable = true;
    this.needle = needle;
  }
  passes(_attribute: string, value: any): boolean {
    const s = typeof value === 'string' ? value : String(value ?? '');
    return !s.includes(this.needle);
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must not contain "${this.needle}".`;
  }
}

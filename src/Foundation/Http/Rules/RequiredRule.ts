import { BaseRule } from './Base';

export class RequiredRule extends BaseRule {
  constructor() {
    super('required');
    this.invokable = true;
  }
  passes(_attribute: string, value: any): boolean {
    return !(value === undefined || value === null || value === '');
  }
  messageFor(attribute: string): string {
    return `The ${attribute} field is required.`;
  }
}

import { BaseRule } from './Base';

export class FileRule extends BaseRule {
  constructor() {
    super('file');
    this.invokable = true;
  }
  passes(_attribute: string, value: any): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object') return false;
    const size = Number(value.size ?? value.length ?? 0);
    return Number.isFinite(size) && size >= 0;
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be a file.`;
  }
}

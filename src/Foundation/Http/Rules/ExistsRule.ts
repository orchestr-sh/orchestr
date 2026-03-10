import { BaseRule } from './Base';

export class ExistsRule extends BaseRule {
  constructor(table: string, column?: string) {
    super(column ? `exists:${table},${column}` : `exists:${table}`);
  }
}

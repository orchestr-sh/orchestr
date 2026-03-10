import { BaseRule } from './Base';

export class UniqueRule extends BaseRule {
  constructor(table: string, column?: string) {
    super(column ? `unique:${table},${column}` : `unique:${table}`);
  }
}

import { BaseRule } from './Base';

export class RequiredWithoutAllRule extends BaseRule {
  constructor(...fields: string[]) {
    super(`required_without_all:${fields.join(',')}`);
  }
}

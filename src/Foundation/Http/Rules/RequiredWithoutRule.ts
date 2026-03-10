import { BaseRule } from './Base';

export class RequiredWithoutRule extends BaseRule {
  constructor(...fields: string[]) {
    super(`required_without:${fields.join(',')}`);
  }
}

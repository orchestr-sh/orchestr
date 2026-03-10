import { BaseRule } from './Base';

export class NotRegexRule extends BaseRule {
  constructor(pattern: string | RegExp) {
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    super(`not_regex:${source}`);
  }
}

import { BaseRule } from './Base';

export class RegexRule extends BaseRule {
  constructor(pattern: string | RegExp) {
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    super(`regex:${source}`);
  }
}

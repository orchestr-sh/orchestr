/**
 * Validation rule stub - an invokable rule object shaped like the
 * framework's own BaseRule so the Validator runs it through its
 * `ValidationRuleObject` contract.
 *
 * Laravel: Illuminate\Foundation\Console\RuleMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import type { ValidationRuleObject } from '@orchestr-sh/orchestr';

export class {{ class }} implements ValidationRuleObject {
  /**
   * The rule name, used for message lookups.
   */
  rule = '{{ rule_name }}';

  /**
   * The failure message reported when validation fails.
   */
  message?: string;

  constructor(message?: string) {
    this.message = message;
  }

  /**
   * Determine if the value passes validation.
   */
  passes(attribute: string, value: any, context?: any): boolean | Promise<boolean> {
    // Example: return String(value).startsWith('{{ rule_name }}');
    return true;
  }

  /**
   * The message to report for a failing value.
   */
  messageFor(attribute: string, value: any, context?: any): string | undefined {
    return this.message;
  }
}
`;

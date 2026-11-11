import type { Response } from '@/Auth/Access/Response';
import { resolveGate } from '@/Auth/Access/Gate';
import { BaseRule } from './Base';

/**
 * Rule.can('update', post) - validates that the authenticated user passes
 * the gate check, with the rule arguments (models or plain values) forwarded
 * as ability arguments. The verdict comes from the application's shared
 * gate (DRY: the same service the 'can' middleware, Request.can and
 * FormRequest.authorize use); a denial fails the field, using the
 * Response's message when the gate carried one.
 *
 * Laravel: Illuminate\Validation\Rules\Can
 */
export class CanRule extends BaseRule {
  /**
   * The ability the gate is asked about
   */
  public readonly ability: string;

  /**
   * Ability arguments: models, ids or plain values passed to the callback
   */
  public readonly arguments: any[];

  /**
   * The last inspected Response, kept so the field error carries the
   * denial message
   */
  private response?: Response;

  constructor(ability: string, ...args: any[]) {
    super(`can:${ability}`);
    this.ability = ability;
    this.arguments = args;
    this.invokable = true;
  }

  /**
   * Run the check through the gate
   * Laravel: Can::passes()
   */
  async passes(): Promise<boolean> {
    this.response = await resolveGate().inspect(this.ability, this.arguments);

    return this.response.allowed;
  }

  /**
   * The field error: a custom message, the gate's denial message when it
   * carries one, or Laravel's generic wording
   */
  messageFor(attribute: string): string {
    if (this.message) {
      return this.message;
    }

    return this.response?.message() || `The ${attribute} is invalid.`;
  }
}

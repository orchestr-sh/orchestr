export interface ValidationRuleObject {
  rule: string;
  message?: string;
}

export class BaseRule implements ValidationRuleObject {
  rule: string;
  message?: string;
  invokable?: boolean;
  constructor(rule: string, message?: string) {
    this.rule = rule;
    this.message = message;
    this.invokable = false;
  }
  // Invokable rule contract
  // Override in subclasses to implement rule logic locally
  passes(_attribute: string, _value: any, _ctx: any): boolean | Promise<boolean> {
    return true;
  }
  messageFor(_attribute: string, _value: any, _ctx: any): string | undefined {
    return this.message;
  }
}

import { BaseRule } from './Base';

export class DecimalRule extends BaseRule {
  constructor(places?: number) {
    super(places !== undefined ? `decimal:${places}` : 'decimal');
  }
}

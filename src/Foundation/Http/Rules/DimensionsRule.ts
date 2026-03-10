import { BaseRule } from './Base';

type DimensionsOptions = {
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

export class DimensionsRule extends BaseRule {
  private opts: DimensionsOptions;
  constructor(opts: DimensionsOptions) {
    super('dimensions');
    this.invokable = true;
    this.opts = opts;
  }
  passes(_attribute: string, value: any): boolean {
    if (!value || typeof value !== 'object') return true;
    const w = Number(value.width ?? value.w);
    const h = Number(value.height ?? value.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return true;
    if (this.opts.width !== undefined && w !== this.opts.width) return false;
    if (this.opts.height !== undefined && h !== this.opts.height) return false;
    if (this.opts.minWidth !== undefined && w < this.opts.minWidth) return false;
    if (this.opts.maxWidth !== undefined && w > this.opts.maxWidth) return false;
    if (this.opts.minHeight !== undefined && h < this.opts.minHeight) return false;
    if (this.opts.maxHeight !== undefined && h > this.opts.maxHeight) return false;
    return true;
  }
  messageFor(attribute: string): string {
    return `The ${attribute} has invalid image dimensions.`;
  }
}

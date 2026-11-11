import type { ImageDimensions } from '@/Support/Mimes';
import { isUploadedFile } from '@/Routing/UploadedFile';
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
  async passes(_attribute: string, value: any): Promise<boolean> {
    if (!value || typeof value !== 'object') return true;

    let dims: ImageDimensions | null = null;

    if (isUploadedFile(value)) {
      // Read the raster header from the upload's bytes - getimagesize in PHP
      dims = await value.dimensions();
    } else {
      const w = Number(value.width ?? value.w);
      const h = Number(value.height ?? value.h);

      if (Number.isFinite(w) && Number.isFinite(h)) {
        dims = { width: w, height: h };
      }
    }

    if (dims === null) return true;

    const w = dims.width;
    const h = dims.height;

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

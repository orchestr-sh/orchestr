import { BaseRule } from './Base';

export class ImageFileRule extends BaseRule {
  constructor() {
    super('image_file');
    this.invokable = true;
  }
  passes(_attribute: string, value: any): boolean {
    if (value && typeof value === 'object') {
      const type = (value.mimetype || value.type || '').toString();
      return type.startsWith('image/');
    }
    return true;
  }
  messageFor(attribute: string): string {
    return `The ${attribute} must be an image file.`;
  }
}

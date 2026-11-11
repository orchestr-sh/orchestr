import { isUploadedFile } from '@/Routing/UploadedFile';
import { IMAGE_EXTENSIONS } from '@/Support/Mimes';
import { BaseRule } from './Base';

export class ImageFileRule extends BaseRule {
  constructor() {
    super('image_file');
    this.invokable = true;
  }
  async passes(_attribute: string, value: any): Promise<boolean> {
    if (isUploadedFile(value)) {
      if (!value.isValid()) return false;
      const extension = await value.guessExtension();
      return IMAGE_EXTENSIONS.includes(extension) || (await value.detectedMimeType()).startsWith('image/');
    }
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

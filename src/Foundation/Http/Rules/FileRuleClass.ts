import { BaseRule } from './Base';

export class FileRule extends BaseRule {
  constructor() {
    super('file');
  }
}
export class ImageRule extends BaseRule {
  constructor() {
    super('image');
  }
}
export class MimetypesRule extends BaseRule {
  constructor(types: string[]) {
    super(`mimetypes:${types.join(',')}`);
  }
}
export class MimesRule extends BaseRule {
  constructor(exts: string[]) {
    super(`mimes:${exts.join(',')}`);
  }
}

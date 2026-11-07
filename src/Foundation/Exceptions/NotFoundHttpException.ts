import { HttpException } from './HttpException';

/**
 * NotFoundHttpException - the 404 raised by abort(404) and by dispatch when
 * no route matches
 * Laravel: Symfony\Component\HttpKernel\Exception\NotFoundHttpException
 */
export class NotFoundHttpException extends HttpException {
  constructor(message: string = '', headers: Record<string, string> = {}) {
    super(404, message, headers);
    this.name = 'NotFoundHttpException';

    Object.setPrototypeOf(this, NotFoundHttpException.prototype);
  }
}

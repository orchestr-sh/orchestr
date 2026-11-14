/**
 * Middleware stub - the framework's middleware surface is the functional
 * `Middleware` type, so generated middleware is an exported const.
 *
 * Laravel: Illuminate\Foundation\Console\MiddlewareMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import type { Middleware } from '@orchestr-sh/orchestr';

export const {{ class }}: Middleware = async (request, response, next) => {
  // Do the middleware's work before passing the request along...

  await next();

  // ...or after, once the response has been produced.
};
`;

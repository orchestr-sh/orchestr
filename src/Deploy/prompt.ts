/**
 * prompt
 *
 * Lightweight interactive prompt using readline (Node.js built-in).
 */

import { createInterface } from 'readline';

/**
 * Prompt the user for input. Optionally hides input for passwords.
 */
export function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      // Suppress echo for password input
      const muted = process.stdout;
      const write = muted.write.bind(muted);
      (muted as any).write = (chunk: any, ...args: any[]) => {
        if (typeof chunk === 'string' && chunk !== question) return true;
        return write(chunk, ...args);
      };

      rl.question(question, (answer) => {
        (muted as any).write = write;
        process.stdout.write('\n');
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * CommandOptions
 *
 * The raw option bag handed to `Command.handle()`. Keys are `--option`
 * names as given on the command line; the kernel canonicalises declared
 * shortcuts, applies signature defaults, and passes everything else
 * through untouched.
 */

export interface CommandOptions {
  [key: string]: any;
}

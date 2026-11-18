/**
 * Validation message localization
 *
 * The Validator resolves default messages from
 * `lang/{locale}/validation.ts|json` and attribute names from
 * `lang/{locale}/attributes.ts|json` through the container's translator,
 * keeping its hard-coded English strings as the fallback whenever no
 * translator (or no line) is available.
 */

import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Application } from '@/Foundation/Application';
import { ConfigServiceProvider } from '@/Foundation/Config/ConfigServiceProvider';
import { Validator } from '@/Foundation/Http/Validator';
import { TranslationServiceProvider } from '@/Translation/TranslationServiceProvider';
import { Translator } from '@/Translation/Translator';

const FIXTURES = join(process.cwd(), 'tests/Translation/fixtures');

async function bootApp(locale: string): Promise<Application> {
  const app = new Application(FIXTURES);

  app.register(new ConfigServiceProvider(app, { app: { locale, fallback_locale: 'en' } }));
  app.register(TranslationServiceProvider);
  await app.boot();

  return app;
}

async function errorsFor(data: Record<string, any>, rules: Record<string, string>): Promise<Record<string, string[]>> {
  const validator = Validator.make(data, rules);

  await validator.validate();

  return validator.errors();
}

describe('translated validation messages', () => {
  it('uses validation.{rule} lines and attributes.{field} names', async () => {
    await bootApp('en');

    const errors = await errorsFor({ first_name: '' }, { first_name: 'required' });

    expect(errors.first_name).toEqual(['The first name field is required (translated).']);
  });

  it('replaces rule parameters like :min and :max', async () => {
    await bootApp('en');

    const min = await errorsFor({ password: 'abc' }, { password: 'min:6' });
    const between = await errorsFor({ age: 5 }, { age: 'between:10,20' });

    expect(min.password).toEqual(['The password must be at least 6 characters.']);
    expect(between.age).toEqual(['The age must be between 10 and 20.']);
  });

  it('joins list parameters into :values', async () => {
    await bootApp('en');

    const errors = await errorsFor({ name: 'zed' }, { name: 'starts_with:ada,bo' });

    expect(errors.name).toEqual(['The name must start with one of ada, bo.']);
  });

  it('prefers validation.custom.{field}.{rule} lines', async () => {
    await bootApp('en');

    const errors = await errorsFor({ email: '' }, { email: 'required' });

    expect(errors.email).toEqual(['Please provide an email address.']);
  });

  it('keeps constructor-supplied custom messages on top', async () => {
    await bootApp('en');

    const validator = Validator.make({ email: '' }, { email: 'required' }, { 'email.required': 'Mine!' });

    await validator.validate();

    expect(validator.errors().email).toEqual(['Mine!']);
  });

  it('selects size-based variants by value type', async () => {
    await bootApp('en');

    const errors = await errorsFor({ count: 1 }, { count: 'min:3' });

    expect(errors.count).toEqual(['The count must be at least 3.']);

    // String values get the characters variant (asserted above via min:6)
  });

  it('falls back to the hard-coded English string for untranslated rules', async () => {
    await bootApp('en');

    const errors = await errorsFor({ quantity: 'abc' }, { quantity: 'integer' });

    expect(errors.quantity).toEqual(['The quantity must be an integer.']);
  });

  it('resolves messages for the active locale after a switch', async () => {
    const app = await bootApp('en');

    const before = await errorsFor({ email: 'nope' }, { email: 'email' });

    expect(before.email).toEqual(['The email address must be a valid email address.']);

    app.make<Translator>('translator').setLocale('fr');

    const after = await errorsFor({ email: 'nope' }, { email: 'email' });

    // ...and the attribute name from lang/fr/attributes.json
    expect(after.email).toEqual(['Le champ adresse e-mail doit être une adresse e-mail valide.']);
  });

  it('serves module language files (lang/de/validation.ts) after boot preload', async () => {
    await bootApp('de');

    const errors = await errorsFor({ title: '' }, { title: 'required' });

    expect(errors.title).toEqual(['Das Feld title ist erforderlich.']);
  });

  it('behaves exactly as before when no translator is bound', async () => {
    // A fresh application without TranslationServiceProvider: the global
    // app has no 'translator' binding, so the inline fallbacks answer.
    new Application(FIXTURES);

    const errors = await errorsFor({ first_name: '' }, { first_name: 'required' });

    expect(errors.first_name).toEqual(['The first name field is required.']);
  });

  it('translates messages raised by wildcard-expanded rules', async () => {
    await bootApp('en');

    const validator = Validator.make({ users: [{ email: 'ada@example.com' }, {}] }, { 'users.*.email': 'required' });

    await validator.validate();

    expect(validator.errors()['users.1.email']).toEqual(['The users.1.email field is required (translated).']);
  });
});

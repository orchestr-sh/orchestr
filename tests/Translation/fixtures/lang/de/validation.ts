/**
 * Fixture German validation lines as a *module* file: loading needs an
 * async import, so this locale only answers once the translator has
 * preloaded it (what TranslationServiceProvider's boot does).
 */

export default {
  required: 'Das Feld :attribute ist erforderlich.',
};

/**
 * Fixture with a non-serializable value, used to prove config caching
 * rejects closures instead of silently dropping them.
 */
export default {
  before: () => 'never serialized',
};

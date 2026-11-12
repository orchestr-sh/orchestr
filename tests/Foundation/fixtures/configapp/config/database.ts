/**
 * Fixture config file for ConfigLoader/ConfigServiceProvider tests.
 * Loaded dynamically as `config/database.ts` -> key `database`.
 */
export default {
  default: 'mysql',
  connections: {
    mysql: {
      driver: 'mysql',
      host: '127.0.0.1',
      database: 'orchestr',
    },
  },
};

import { describe, it, expect } from 'vitest';
import { Str } from '@/Support/Str';

describe('Str', () => {
  describe('case conversions', () => {
    it('camel() converts to camelCase', () => {
      expect(Str.camel('foo_bar')).toBe('fooBar');
      expect(Str.camel('foo-bar')).toBe('fooBar');
      expect(Str.camel('Foo Bar')).toBe('fooBar');
      expect(Str.camel('fooBar')).toBe('fooBar');
      expect(Str.camel('')).toBe('');
    });

    it('studly() converts to StudlyCase', () => {
      expect(Str.studly('foo_bar')).toBe('FooBar');
      expect(Str.studly('foo-bar')).toBe('FooBar');
      expect(Str.studly('foo bar')).toBe('FooBar');
      expect(Str.studly('fooBar')).toBe('FooBar');
      expect(Str.studly('Hello, World!')).toBe('HelloWorld');
      expect(Str.studly('')).toBe('');
    });

    it('studly() keeps unicode letters', () => {
      expect(Str.studly('héllo_world')).toBe('HélloWorld');
    });

    it('snake() converts to snake_case', () => {
      expect(Str.snake('foo_bar')).toBe('foo_bar');
      expect(Str.snake('FooBar')).toBe('foo_bar');
      expect(Str.snake('fooBar')).toBe('foo_bar');
      expect(Str.snake('HTTPServer')).toBe('http_server');
      expect(Str.snake('version2')).toBe('version2');
      expect(Str.snake('foo bar')).toBe('foo_bar');
      expect(Str.snake('')).toBe('');
    });

    it('snake() supports custom delimiters and casing', () => {
      expect(Str.snake('fooBar', '-')).toBe('foo-bar');
      expect(Str.snake('fooBar', '_', false)).toBe('FOO_BAR');
    });

    it('kebab() converts to kebab-case', () => {
      expect(Str.kebab('fooBar')).toBe('foo-bar');
      expect(Str.kebab('Foo Bar')).toBe('foo-bar');
      expect(Str.kebab('')).toBe('');
    });

    it('title() title-cases every word', () => {
      expect(Str.title('hello world')).toBe('Hello World');
      expect(Str.title('HELLO WORLD')).toBe('Hello World');
      expect(Str.title('foo BAR')).toBe('Foo Bar');
      expect(Str.title('über cool')).toBe('Über Cool');
      expect(Str.title('')).toBe('');
    });

    it('headline() produces human-readable headlines', () => {
      expect(Str.headline('helloWorld')).toBe('Hello World');
      expect(Str.headline('foo_bar-baz')).toBe('Foo Bar Baz');
      expect(Str.headline('srkDogFetus')).toBe('Srk Dog Fetus');
      expect(Str.headline('')).toBe('');
    });
  });

  describe('slug()', () => {
    it('slugifies common strings', () => {
      expect(Str.slug('Hello, World!')).toBe('hello-world');
      expect(Str.slug('  spaces  everywhere  ')).toBe('spaces-everywhere');
      expect(Str.slug('foo_bar')).toBe('foo-bar');
      expect(Str.slug('a--b')).toBe('a-b');
      expect(Str.slug('')).toBe('');
    });

    it('slugifies unicode through transliteration', () => {
      expect(Str.slug('Àéîõü')).toBe('aeiou');
      expect(Str.slug('Grüße', '-', 'de')).toBe('gruesse');
      expect(Str.slug('привет мир', '-', 'ru')).toBe('privet-mir');
    });

    it('respects custom separators', () => {
      expect(Str.slug('Hello World', '_')).toBe('hello_world');
      expect(Str.slug('Hello World', ' ')).toBe('hello world');
    });
  });

  describe('pluralization', () => {
    it('plural() regular patterns', () => {
      expect(Str.plural('user')).toBe('users');
      expect(Str.plural('box')).toBe('boxes');
      expect(Str.plural('church')).toBe('churches');
      expect(Str.plural('city')).toBe('cities');
      expect(Str.plural('baby')).toBe('babies');
      expect(Str.plural('day')).toBe('days');
      expect(Str.plural('knife')).toBe('knives');
      expect(Str.plural('wolf')).toBe('wolves');
      expect(Str.plural('analysis')).toBe('analyses');
      expect(Str.plural('status')).toBe('statuses');
      expect(Str.plural('bus')).toBe('buses');
      expect(Str.plural('datum')).toBe('data');
      expect(Str.plural('index')).toBe('indices');
      expect(Str.plural('matrix')).toBe('matrices');
      expect(Str.plural('quiz')).toBe('quizzes');
      expect(Str.plural('potato')).toBe('potatoes');
      expect(Str.plural('hero')).toBe('heroes');
      expect(Str.plural('news')).toBe('news');
      expect(Str.plural('')).toBe('');
    });

    it('plural() exceptions and irregulars', () => {
      expect(Str.plural('person')).toBe('people');
      expect(Str.plural('man')).toBe('men');
      expect(Str.plural('human')).toBe('humans');
      expect(Str.plural('woman')).toBe('women');
      expect(Str.plural('child')).toBe('children');
      expect(Str.plural('mouse')).toBe('mice');
      expect(Str.plural('ox')).toBe('oxen');
      expect(Str.plural('goose')).toBe('geese');
      expect(Str.plural('foot')).toBe('feet');
      expect(Str.plural('tooth')).toBe('teeth');
    });

    it('plural() uncountables are unchanged', () => {
      expect(Str.plural('sheep')).toBe('sheep');
      expect(Str.plural('fish')).toBe('fish');
      expect(Str.plural('series')).toBe('series');
      expect(Str.plural('equipment')).toBe('equipment');
      expect(Str.plural('information')).toBe('information');
    });

    it('plural() keeps prefixes and casing', () => {
      expect(Str.plural('Person')).toBe('People');
      expect(Str.plural('Salesperson')).toBe('Salespeople');
      expect(Str.plural('Baby')).toBe('Babies');
    });

    it('plural() respects the count argument', () => {
      expect(Str.plural('user', 1)).toBe('user');
      expect(Str.plural('user', 2)).toBe('users');
      expect(Str.plural('user', 0)).toBe('users');
    });

    it('singular() regular patterns', () => {
      expect(Str.singular('users')).toBe('user');
      expect(Str.singular('boxes')).toBe('box');
      expect(Str.singular('churches')).toBe('church');
      expect(Str.singular('cities')).toBe('city');
      expect(Str.singular('babies')).toBe('baby');
      expect(Str.singular('knives')).toBe('knife');
      expect(Str.singular('wolves')).toBe('wolf');
      expect(Str.singular('analyses')).toBe('analysis');
      expect(Str.singular('statuses')).toBe('status');
      expect(Str.singular('buses')).toBe('bus');
      expect(Str.singular('data')).toBe('datum');
      expect(Str.singular('indices')).toBe('index');
      expect(Str.singular('matrices')).toBe('matrix');
      expect(Str.singular('quizzes')).toBe('quiz');
      expect(Str.singular('potatoes')).toBe('potato');
      expect(Str.singular('heroes')).toBe('hero');
      expect(Str.singular('shoes')).toBe('shoe');
      expect(Str.singular('movies')).toBe('movie');
      expect(Str.singular('leaves')).toBe('leaf');
      expect(Str.singular('wives')).toBe('wife');
      expect(Str.singular('waves')).toBe('wave');
      expect(Str.singular('news')).toBe('news');
      expect(Str.singular('tests')).toBe('test');
      expect(Str.singular('crises')).toBe('crisis');
      expect(Str.singular('axes')).toBe('axis');
      expect(Str.singular('axis')).toBe('axis');
      expect(Str.singular('status')).toBe('status');
      expect(Str.singular('grass')).toBe('grass');
      expect(Str.singular('')).toBe('');
    });

    it('singular() exceptions and irregulars', () => {
      expect(Str.singular('people')).toBe('person');
      expect(Str.singular('People')).toBe('Person');
      expect(Str.singular('Salespeople')).toBe('Salesperson');
      expect(Str.singular('men')).toBe('man');
      expect(Str.singular('women')).toBe('woman');
      expect(Str.singular('children')).toBe('child');
      expect(Str.singular('mice')).toBe('mouse');
      expect(Str.singular('oxen')).toBe('ox');
      expect(Str.singular('geese')).toBe('goose');
      expect(Str.singular('feet')).toBe('foot');
      expect(Str.singular('teeth')).toBe('tooth');
    });

    it('singular() uncountables are unchanged', () => {
      expect(Str.singular('sheep')).toBe('sheep');
      expect(Str.singular('series')).toBe('series');
      expect(Str.singular('species')).toBe('species');
      expect(Str.singular('fish')).toBe('fish');
      expect(Str.singular('equipment')).toBe('equipment');
    });
  });

  describe('truncation', () => {
    it('limit() truncates on character counts', () => {
      expect(Str.limit('The PHP framework for web artisans', 7)).toBe('The PHP...');
      expect(Str.limit('12345', 3)).toBe('123...');
      expect(Str.limit('Hello world', 5)).toBe('Hello...');
      expect(Str.limit('abc', 10)).toBe('abc');
      expect(Str.limit('abc')).toBe('abc');
      expect(Str.limit('12345', 3, '')).toBe('123');
      expect(Str.limit('', 5)).toBe('');
    });

    it('limit() counts unicode code points', () => {
      expect(Str.limit('日本語のテキスト', 3)).toBe('日本語...');
      expect(Str.limit('😀😀😀😀', 2)).toBe('😀😀...');
    });

    it('words() truncates on word counts', () => {
      expect(Str.words('Hello world, this is PHP.', 2)).toBe('Hello world,...');
      expect(Str.words('Hello world', 2)).toBe('Hello world');
      expect(Str.words('a b c d', 3, '!')).toBe('a b c!');
      expect(Str.words('')).toBe('');
    });
  });

  describe('random generators', () => {
    it('random() returns an alphanumeric string of the given length', () => {
      expect(Str.random(16)).toMatch(/^[0-9a-zA-Z]{16}$/);
      expect(Str.random()).toHaveLength(16);
      expect(Str.random(0)).toBe('');
    });

    it('uuid() returns a v4 UUID', () => {
      expect(Str.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(Str.uuid()).not.toBe(Str.uuid());
    });

    it('ulid() returns a 26 character Crockford base32 value', () => {
      const ulid = Str.ulid();

      expect(ulid).toHaveLength(26);
      expect(ulid).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);
    });

    it('ulid() timestamp prefix is ordered by creation time', () => {
      const earlier = Str.ulid();
      const later = Str.ulid();

      // The first 9 characters encode the 48-bit millisecond timestamp
      // (the top 3 bits are zero), so they are lexicographically
      // non-decreasing; the 10th character mixes in random bits.
      expect(later.slice(0, 9) >= earlier.slice(0, 9)).toBe(true);
    });
  });

  describe('searching', () => {
    it('contains() checks substrings case-sensitively by default', () => {
      expect(Str.contains('Hello World', 'World')).toBe(true);
      expect(Str.contains('Hello World', 'world')).toBe(false);
      expect(Str.contains('Hello World', 'world', true)).toBe(true);
      expect(Str.contains('Hello World', ['Goodbye', 'World'])).toBe(true);
      expect(Str.contains('Hello World', [])).toBe(false);
    });

    it('contains() works with unicode', () => {
      expect(Str.contains('日本語', '本語')).toBe(true);
    });

    it('startsWith() and endsWith() accept needles lists', () => {
      expect(Str.startsWith('Hello', 'He')).toBe(true);
      expect(Str.startsWith('Hello', ['He', 'Ho'])).toBe(true);
      expect(Str.startsWith('Hello', [])).toBe(true);
      expect(Str.endsWith('Hello', 'lo')).toBe(true);
      expect(Str.endsWith('Hello', ['xy', 'lo'])).toBe(true);
    });

    it('is() matches wildcard patterns', () => {
      expect(Str.is('ham*', 'hamburg')).toBe(true);
      expect(Str.is('ham*', 'spam')).toBe(false);
      expect(Str.is(['ham*', 'spam'], 'spam')).toBe(true);
      expect(Str.is('*', '')).toBe(true);
      expect(Str.is('foo*', ['bar', 'food'])).toBe(true);
    });

    it('is() treats regex characters as literals', () => {
      expect(Str.is('a.b', 'axb')).toBe(false);
      expect(Str.is('a.b', 'a.b')).toBe(true);
    });
  });

  describe('substrings', () => {
    it('after() / before() split around a needle', () => {
      expect(Str.after('http://example.com', '://')).toBe('example.com');
      expect(Str.after('abc', 'x')).toBe('abc');
      expect(Str.afterLast('a/b/c', '/')).toBe('c');
      expect(Str.before('http://example.com', '/')).toBe('http:');
      expect(Str.before('abc', 'x')).toBe('abc');
      expect(Str.beforeLast('a.b.c', '.')).toBe('a.b');
      expect(Str.after('', 'x')).toBe('');
    });

    it('between() returns the inner segment', () => {
      expect(Str.between('--laravel-framework--', '--', '--')).toBe('laravel-framework');
      expect(Str.between('example.com', 'exam', 'm')).toBe('ple.co');
      expect(Str.between('abc', 'x', 'y')).toBe('');
    });

    it('betweenFirst() returns the smallest segment', () => {
      expect(Str.betweenFirst('{{foo}}bar{{baz}}', '{{', '}}')).toBe('foo');
      expect(Str.betweenFirst('abc', 'x', 'y')).toBe('abc');
    });

    it('replaceFirst() / replaceLast() touch a single occurrence', () => {
      expect(Str.replaceFirst('laravel', 'orchestr', 'laravel and laravel')).toBe('orchestr and laravel');
      expect(Str.replaceLast('laravel', 'orchestr', 'laravel and laravel')).toBe('laravel and orchestr');
      expect(Str.replaceFirst('x', 'y', 'abc')).toBe('abc');
      expect(Str.replaceArray('?', ['1', '2'], 'a ? b ? c ?')).toBe('a 1 b 2 c ?');
    });

    it('start() / finish() add caps only when missing', () => {
      expect(Str.start('laravel.com', 'https://')).toBe('https://laravel.com');
      expect(Str.start('https://laravel.com', 'https://')).toBe('https://laravel.com');
      expect(Str.finish('laravel', '.php')).toBe('laravel.php');
      expect(Str.finish('laravel.php', '.php')).toBe('laravel.php');
    });
  });

  describe('ascii, masking, padding and length', () => {
    it('ascii() transliterates to ASCII', () => {
      expect(Str.ascii('café')).toBe('cafe');
      expect(Str.ascii('grüße', 'de')).toBe('gruesse');
      expect(Str.ascii('привет', 'ru')).toBe('privet');
      expect(Str.ascii('a & b')).toBe('a and b');
      expect(Str.ascii('')).toBe('');
    });

    it('isAscii() detects 7 bit strings', () => {
      expect(Str.isAscii('Hello')).toBe(true);
      expect(Str.isAscii('Héllo')).toBe(false);
      expect(Str.isAscii('')).toBe(true);
    });

    it('mask() hides portions of a string', () => {
      expect(Str.mask('123456789', '*')).toBe('*********');
      expect(Str.mask('123456789', '*', 4)).toBe('****56789');
      expect(Str.mask('123456789', '*', -4)).toBe('12345****');
      expect(Str.mask('123456789', '*', 0)).toBe('123456789');
      expect(Str.mask('123456789', '*', 99)).toBe('*********');
      expect(Str.mask('123456789', '*-', 4)).toBe('*-*-' + '56789');
      expect(Str.mask('', '*')).toBe('');
    });

    it('padLeft() / padRight() pad to the requested length', () => {
      expect(Str.padLeft('5', 3, '0')).toBe('005');
      expect(Str.padRight('foo', 5, '-')).toBe('foo--');
      expect(Str.padLeft('foo', 5)).toBe('  foo');
      expect(Str.padLeft('abcdef', 3)).toBe('abcdef');
      expect(Str.padLeft('5', -1)).toBe('5');
    });

    it('length() counts code points not UTF-16 units', () => {
      expect(Str.length('日本語')).toBe(3);
      expect(Str.length('😀')).toBe(1);
      expect(Str.length('')).toBe(0);
    });
  });
});

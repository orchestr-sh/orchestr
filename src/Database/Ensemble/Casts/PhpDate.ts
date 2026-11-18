/**
 * PHP date format rendering
 *
 * The subset of PHP's `date()` tokens the date casts need to serialize a
 * `Date` the way Laravel serializes a Carbon. Unrecognised characters are
 * emitted verbatim, the way PHP leaves stray letters alone, and `X` escapes
 * to a literal `X`.
 *
 * Laravel: Illuminate\Support_DateFactory (Carbon creation/formatting)
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, '0');
}

function timezoneToken(minutes: number, colon: boolean): string {
  const sign = minutes >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(minutes) / 60));
  const parts = colon ? `${hours}:${pad(Math.abs(minutes) % 60)}` : `${hours}${pad(Math.abs(minutes) % 60)}`;

  return `${sign}${parts}`;
}

/**
 * Format a Date using PHP date format characters.
 */
export function formatDate(date: Date, format: string): string {
  let output = '';

  for (let index = 0; index < format.length; index++) {
    const token = format[index];

    if (token === '\\' && index + 1 < format.length) {
      output += format[++index];
      continue;
    }

    switch (token) {
      case 'd':
        output += pad(date.getDate());
        break;
      case 'j':
        output += String(date.getDate());
        break;
      case 'D':
        output += DAY_NAMES[date.getDay()].slice(0, 3);
        break;
      case 'l':
        output += DAY_NAMES[date.getDay()];
        break;
      case 'N':
        output += String(date.getDay() === 0 ? 7 : date.getDay());
        break;
      case 'w':
        output += String(date.getDay());
        break;
      case 'm':
        output += pad(date.getMonth() + 1);
        break;
      case 'n':
        output += String(date.getMonth() + 1);
        break;
      case 'M':
        output += MONTH_NAMES[date.getMonth()].slice(0, 3);
        break;
      case 'F':
        output += MONTH_NAMES[date.getMonth()];
        break;
      case 'y':
        output += pad(date.getFullYear() % 100);
        break;
      case 'Y':
        output += String(date.getFullYear());
        break;
      case 'H':
        output += pad(date.getHours());
        break;
      case 'G':
        output += String(date.getHours());
        break;
      case 'h':
        output += pad(date.getHours() % 12 === 0 ? 12 : date.getHours() % 12);
        break;
      case 'g': {
        const hours = date.getHours() % 12;
        output += String(hours === 0 ? 12 : hours);
        break;
      }
      case 'i':
        output += pad(date.getMinutes());
        break;
      case 's':
        output += pad(date.getSeconds());
        break;
      case 'u':
        output += pad(date.getMilliseconds(), 3);
        break;
      case 'A':
        output += date.getHours() < 12 ? 'AM' : 'PM';
        break;
      case 'a':
        output += date.getHours() < 12 ? 'am' : 'pm';
        break;
      case 'U':
        output += String(Math.floor(date.getTime() / 1000));
        break;
      case 'O':
        output += timezoneToken(-date.getTimezoneOffset(), false);
        break;
      case 'P':
        output += timezoneToken(-date.getTimezoneOffset(), true);
        break;
      case 'c':
        output += date.toISOString();
        break;
      default:
        output += token;
    }
  }

  return output;
}

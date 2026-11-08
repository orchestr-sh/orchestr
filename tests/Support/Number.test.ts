import { describe, it, expect } from 'vitest';
import { Number } from '@/Support/Number';

describe('Number', () => {
  describe('format()', () => {
    it('formats with defaults', () => {
      expect(Number.format(1020)).toBe('1,020');
      expect(Number.format(1020.1234, 2)).toBe('1,020.12');
      expect(Number.format(1020.1234, 2, ',', '.')).toBe('1.020,12');
      expect(Number.format(1020, 0, '.', ' ')).toBe('1 020');
      expect(Number.format(0)).toBe('0');
    });

    it('rounds halves away from zero', () => {
      expect(Number.format(1.005, 2)).toBe('1.01');
      expect(Number.format(1.5)).toBe('2');
      expect(Number.format(2.5)).toBe('3');
      expect(Number.format(-1.5)).toBe('-2');
    });

    it('handles negative numbers and nullish input', () => {
      expect(Number.format(-1234.5, 1)).toBe('-1,234.5');
      expect(Number.format(-1020)).toBe('-1,020');
      expect(Number.format(null as any)).toBe('0');
      expect(Number.format(undefined as any)).toBe('0');
    });
  });

  describe('clamp()', () => {
    it('clamps values into the range', () => {
      expect(Number.clamp(5, 1, 10)).toBe(5);
      expect(Number.clamp(12, 1, 10)).toBe(10);
      expect(Number.clamp(-5, 1, 10)).toBe(1);
    });

    it('rounds bounds with the precision arguments', () => {
      // Bounds are rounded first: 1.4 defaults to precision 0 -> 1.
      expect(Number.clamp(1, 1.4, 10, 0)).toBe(1);
      expect(Number.clamp(1, 1.4, 10, 1)).toBe(1.4);
      expect(Number.clamp(1.239, 1.5, 10, 1)).toBe(1.5);
    });

    it('throws when the bounds are inverted', () => {
      expect(() => Number.clamp(5, 10, 1)).toThrow('[$min] should be smaller than [$max].');
    });
  });

  describe('abbreviate()', () => {
    it('abbreviates with decimal scaling', () => {
      expect(Number.abbreviate(1000)).toBe('1K');
      expect(Number.abbreviate(1500)).toBe('1.5K');
      expect(Number.abbreviate(100000)).toBe('100K');
      expect(Number.abbreviate(1200000)).toBe('1.2M');
      expect(Number.abbreviate(1000000000)).toBe('1B');
      expect(Number.abbreviate(1000000000000)).toBe('1T');
    });

    it('honours precision', () => {
      expect(Number.abbreviate(12300000, 2)).toBe('12.30M');
      expect(Number.abbreviate(1234, 2)).toBe('1.23K');
      expect(Number.abbreviate(1234, 1)).toBe('1.2K');
    });

    it('handles small, zero and negative numbers', () => {
      expect(Number.abbreviate(0)).toBe('0');
      expect(Number.abbreviate(999)).toBe('999');
      expect(Number.abbreviate(-1500)).toBe('-1.5K');
      expect(Number.abbreviate(-1230000000, 2)).toBe('-1.23B');
    });
  });

  describe('ordinal()', () => {
    it('renders English ordinals including the exceptions', () => {
      expect(Number.ordinal(0)).toBe('0th');
      expect(Number.ordinal(1)).toBe('1st');
      expect(Number.ordinal(2)).toBe('2nd');
      expect(Number.ordinal(3)).toBe('3rd');
      expect(Number.ordinal(4)).toBe('4th');
      expect(Number.ordinal(11)).toBe('11th');
      expect(Number.ordinal(12)).toBe('12th');
      expect(Number.ordinal(13)).toBe('13th');
      expect(Number.ordinal(21)).toBe('21st');
      expect(Number.ordinal(22)).toBe('22nd');
      expect(Number.ordinal(23)).toBe('23rd');
      expect(Number.ordinal(101)).toBe('101st');
      expect(Number.ordinal(111)).toBe('111th');
      expect(Number.ordinal(122)).toBe('122nd');
    });

    it('handles negative numbers', () => {
      expect(Number.ordinal(-1)).toBe('-1st');
      expect(Number.ordinal(-11)).toBe('-11th');
      expect(Number.ordinal(-21)).toBe('-21st');
    });
  });

  describe('percentage()', () => {
    it('formats symbolic percentages', () => {
      expect(Number.percentage(12.34)).toBe('12 %');
      expect(Number.percentage(12.34, 1)).toBe('12.3 %');
      expect(Number.percentage(10000, 2)).toBe('10,000.00 %');
    });

    it('supports space and symbolic flags', () => {
      expect(Number.percentage(10000, 2, true, false)).toBe('10,000.00%');
      expect(Number.percentage(10000, 2, false)).toBe('10,000.00');
    });

    it('handles negative numbers', () => {
      expect(Number.percentage(-10, 1)).toBe('-10.0 %');
    });
  });

  describe('fileSize()', () => {
    it('formats byte counts with binary scaling', () => {
      expect(Number.fileSize(0)).toBe('0 B');
      expect(Number.fileSize(100)).toBe('100 B');
      expect(Number.fileSize(1024)).toBe('1 KB');
      expect(Number.fileSize(1024, 1)).toBe('1.0 KB');
      expect(Number.fileSize(1024 ** 2)).toBe('1 MB');
      expect(Number.fileSize(1024 ** 3, 2)).toBe('1.00 GB');
      expect(Number.fileSize(1024 ** 4)).toBe('1 TB');
    });

    it('supports canonical units', () => {
      expect(Number.fileSize(1024, 0, true)).toBe('1 KiB');
      expect(Number.fileSize(1024 ** 4, 0, true)).toBe('1 TiB');
    });

    it('handles negative numbers and non-finite values', () => {
      expect(Number.fileSize(-(1024 ** 4))).toBe('-1 TB');
      expect(Number.fileSize(globalThis.Number.POSITIVE_INFINITY)).toBe('0 B');
    });
  });

  describe('spell()', () => {
    it('spells integers in English words', () => {
      expect(Number.spell(0)).toBe('Zero');
      expect(Number.spell(1)).toBe('One');
      expect(Number.spell(15)).toBe('Fifteen');
      expect(Number.spell(21)).toBe('Twenty-One');
      expect(Number.spell(100)).toBe('One Hundred');
      expect(Number.spell(110)).toBe('One Hundred Ten');
      expect(Number.spell(1000)).toBe('One Thousand');
      expect(Number.spell(1001)).toBe('One Thousand, One');
      expect(Number.spell(1000000)).toBe('One Million');
    });

    it('spells large grouped numbers', () => {
      expect(Number.spell(1234567)).toBe('One Million, Two Hundred Thirty-Four Thousand, Five Hundred Sixty-Seven');
      expect(Number.spell(globalThis.Number.MAX_SAFE_INTEGER)).toBe(
        'Nine Quadrillion, Seven Trillion, One Hundred Ninety-Nine Billion, ' +
          'Two Hundred Fifty-Four Million, Seven Hundred Forty Thousand, Nine Hundred Ninety-One'
      );
    });

    it('handles negative numbers', () => {
      expect(Number.spell(-5)).toBe('Negative Five');
    });

    it('is bounded to the safe integer range', () => {
      expect(() => Number.spell(1.5)).toThrow('only supports integers');
      expect(() => Number.spell(1e30)).toThrow('only supports numbers up to');
      expect(Number.spellout(21)).toBe('Twenty-One');
    });
  });
});

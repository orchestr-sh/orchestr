import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '@/Container/Container';

class Summary {}
class Charts {}

describe('Container tags', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    container.bind(Summary, Summary);
    container.bind(Charts, Charts);
  });

  it('tags several abstracts at once and resolves every member', () => {
    container.tag([Summary, Charts], 'reports');

    const tagged = container.tagged('reports');

    expect(tagged).toHaveLength(2);
    expect(tagged[0]).toBeInstanceOf(Summary);
    expect(tagged[1]).toBeInstanceOf(Charts);
  });

  it('accepts a single abstract and a single tag name', () => {
    container.tag(Summary, 'reports');

    expect(container.tagged('reports')).toHaveLength(1);
  });

  it('applies an abstract to multiple tags', () => {
    container.tag(Summary, ['reports', 'widgets']);

    expect(container.tagged('reports')).toHaveLength(1);
    expect(container.tagged('widgets')).toHaveLength(1);
  });

  it('works with string bindings', () => {
    container.bind('summary-service', () => 'summary');
    container.bind('charts-service', () => 'charts');
    container.tag(['summary-service', 'charts-service'], 'reports');

    expect(container.tagged('reports')).toEqual(['summary', 'charts']);
  });

  it('honours a custom resolver for every member', () => {
    container.tag([Summary, Charts], 'reports');

    const wrapped = container.tagged('reports', (abstract, c) => ({
      abstract,
      instance: c.make(abstract),
    }));

    expect(wrapped).toHaveLength(2);
    expect(wrapped[0].abstract).toBe(Summary);
    expect(wrapped[0].instance).toBeInstanceOf(Summary);
    expect(wrapped[1].abstract).toBe(Charts);
  });

  it('returns an empty list for unknown tags', () => {
    expect(container.tagged('nothing')).toEqual([]);
  });

  it('accumulates members across repeated tag() calls', () => {
    container.tag(Summary, 'reports');
    container.tag(Charts, 'reports');

    expect(container.tagged('reports')).toHaveLength(2);
  });
});

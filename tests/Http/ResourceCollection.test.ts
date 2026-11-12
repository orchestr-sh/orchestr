/**
 * API resource collection tests
 *
 * These pin the collection half of the resource layer: `PostResource.collection
 * ($posts)` mapping every item through the resource class, the configured
 * wrapping key, and the pagination metadata a wrapped paginator contributes to
 * the JSON response.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { AnonymousResourceCollection } from '@/Http/Resources/AnonymousResourceCollection';
import { JsonResource } from '@/Http/Resources/JsonResource';
import { ResourceCollection } from '@/Http/Resources/ResourceCollection';
import { Cursor } from '@/Pagination/Cursor';
import { CursorPaginator } from '@/Pagination/CursorPaginator';
import { LengthAwarePaginator } from '@/Pagination/LengthAwarePaginator';
import { Paginator } from '@/Pagination/Paginator';

class Post extends Ensemble {
  static fillable: string[] = ['title'];

  getTable(): string {
    return 'posts';
  }
}

class PostResource extends JsonResource {
  toArray(): Record<string, any> {
    return {
      id: this.resource.getKey(),
      title: this.resource.getAttribute('title'),
    };
  }
}

class PostCollection extends ResourceCollection {
  protected static collects = PostResource;
}

function posts(count: number): Post[] {
  return Array.from({ length: count }, (_, index) => new Post({ id: index + 1, title: `Post ${index + 1}` }, true));
}

afterEach(() => {
  PostResource.withWrapping();
  JsonResource.withWrapping();
});

describe('ResourceCollection', () => {
  it('maps every item through the declared resource class', () => {
    const collection = new PostCollection(posts(2));

    expect(collection.resolve()).toEqual([
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]);
  });

  it('wraps the declared collection under its wrapping key', () => {
    const payload = new PostCollection(posts(2)).toJSONPayload();

    expect(payload).toEqual({
      data: [
        { id: 1, title: 'Post 1' },
        { id: 2, title: 'Post 2' },
      ],
    });
  });

  it('PostResource.collection() returns an anonymous collection of that resource', () => {
    const collection = PostResource.collection(posts(3));

    expect(collection).toBeInstanceOf(AnonymousResourceCollection);
    expect(collection.resource).toHaveLength(3);
  });

  it('accepts model collections and paginators as its source', () => {
    const fromModels = PostResource.collection(new EnsembleCollection(posts(1)));
    expect(fromModels.resolve()).toEqual([{ id: 1, title: 'Post 1' }]);

    const paginator = new LengthAwarePaginator(posts(1), 9, 1, 1, { path: '/posts' });
    expect(PostResource.collection(paginator).resolve()).toEqual([{ id: 1, title: 'Post 1' }]);
  });

  it('renders an empty list as an empty array', () => {
    expect(PostResource.collection([]).resolve()).toEqual([]);
    expect(PostResource.collection([]).toJSONPayload()).toEqual({ data: [] });
  });

  it('unwraps per instance via withoutWrapping()', () => {
    const collection = PostResource.collection(posts(1)).withoutWrapping();

    expect(collection.toJSONPayload()).toEqual([{ id: 1, title: 'Post 1' }]);
  });

  it('honours the class-level wrapping key', () => {
    class WrappedCollection extends PostCollection {
      protected static wrap: string | null = 'post';
    }

    expect(new WrappedCollection(posts(1)).toJSONPayload()).toEqual({
      post: [{ id: 1, title: 'Post 1' }],
    });
  });

  it('merges with() data alongside the wrapped payload', () => {
    const payload = PostResource.collection(posts(1)).with({ app: 'orchestr' }).toJSONPayload();

    expect(payload).toEqual({ data: [{ id: 1, title: 'Post 1' }], app: 'orchestr' });
  });

  it('keeps conditional fields of the mapped resources filtered', () => {
    class SecretResource extends JsonResource {
      toArray(): any {
        return { id: this.resource.getKey(), secret: this.when(false, 'hidden') };
      }
    }

    expect(SecretResource.collection(posts(1)).resolve()).toEqual([{ id: 1 }]);
  });
});

describe('Paginated resources', () => {
  it('merges length-aware pagination metadata next to the wrapped data', () => {
    const paginator = new LengthAwarePaginator(posts(2), 10, 2, 1, { path: '/posts' });
    const payload = PostResource.collection(paginator).toJSONPayload();

    expect((payload as any).data).toEqual([
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]);
    expect((payload as any).meta).toEqual({
      total: 10,
      per_page: 2,
      last_page: 5,
      next_page_url: '/posts?page=2',
      prev_page_url: null,
    });
  });

  it('preserves the pagination query string in resource meta links', () => {
    const paginator = new LengthAwarePaginator(posts(2), 10, 2, 3, { path: '/posts', query: { filter: 'active' } });
    const payload = PostResource.collection(paginator).toJSONPayload() as any;

    expect(payload.meta.next_page_url).toBe('/posts?filter=active&page=4');
    expect(payload.meta.prev_page_url).toBe('/posts?filter=active&page=2');
  });

  it('adds no meta for a plain list', () => {
    expect(PostResource.collection(posts(1)).toJSONPayload()).not.toHaveProperty('meta');
  });

  it('carries the windowed links through toArray of the paginator', () => {
    const paginator = new LengthAwarePaginator(posts(2), 4, 2, 1, { path: '/posts' });
    const response = PostResource.collection(paginator).response();

    expect(response.data.data).toHaveLength(2);
    expect(response.data.meta.total).toBe(4);
    expect(response.encoded()).toContain('"total":4');
  });

  it('gives a simple paginator data without totals', () => {
    const paginator = new Paginator(posts(2).concat(posts(1)), 2, 1, { path: '/posts' });
    const payload = PostResource.collection(paginator).toJSONPayload() as any;

    expect(payload.data).toHaveLength(2);
    expect(payload).not.toHaveProperty('meta');
    expect(paginator.nextPageUrl()).toBe('/posts?page=2');
  });

  it('merges cursor metadata for cursor paginated resources', () => {
    const cursor = new Cursor({ id: 2 }, { id: 'asc' });
    const paginator = new CursorPaginator(posts(2), 2, cursor, {
      path: '/posts',
      index: { id: 'asc' },
      hasMore: true,
      hasPrevious: true,
    });

    const payload = PostResource.collection(paginator).toJSONPayload() as any;

    expect(payload.data).toEqual([
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]);
    expect(payload.meta).toEqual({
      next_cursor: paginator.nextCursor()?.toEncoded(),
      prev_cursor: paginator.previousCursor()?.toEncoded(),
    });
  });

  it('spreads meta beside the items when unwrapped', () => {
    const paginator = new LengthAwarePaginator(posts(1), 1, 1, 1, { path: '/posts' });
    const payload = PostResource.collection(paginator).withoutWrapping().toJSONPayload() as any;

    expect(payload).toEqual({
      0: { id: 1, title: 'Post 1' },
      total: 1,
      per_page: 1,
      last_page: 1,
      next_page_url: null,
      prev_page_url: null,
    });
  });
});

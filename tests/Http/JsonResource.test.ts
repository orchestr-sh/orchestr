/**
 * JsonResource tests
 *
 * Resources own serialisation: these pin the default model passthrough, the
 * conditional field helpers (`when`, `whenHas`, `whenLoaded`, `whenCounted`,
 * `whenAggregated`, `mergeWhen`), the top-level `with`/`additional` bags, and
 * the wrapping key that turns resolved payloads into responses.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { JsonResource } from '@/Http/Resources/JsonResource';
import { MISSING_VALUE } from '@/Http/Resources/JsonResource';

// ---------------------------------------------------------------------------
// Test models and an application resource shaped like the ticket example
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'users';
  }
}

class Post extends Ensemble {
  static fillable: string[] = ['title', 'body', 'published'];

  getTable(): string {
    return 'posts';
  }

  author() {
    return this.belongsTo(User, 'author_id');
  }
}

class PostResource extends JsonResource {
  toArray(request?: any): Record<string, any> {
    return {
      id: this.resource.getKey(),
      title: this.resource.getAttribute('title'),
      body: this.when(request?.showBody ?? false, this.resource.getAttribute('body'), 'hidden'),
      state: this.whenHas(this.resource.getAttribute('published'), 'published', 'draft'),
      author: this.whenLoaded('author'),
      comments_count: this.whenCounted('comments'),
      votes: this.whenAggregated('comments', 'votes', 'sum'),
      ...this.mergeWhen(request?.includeEdits ?? false, { edited_at: '2026-01-02' }),
    };
  }
}

function post(attributes: Record<string, any> = {}): Post {
  return new Post({ id: 1, title: 'Hello', body: 'World', published: 0, ...attributes }, true);
}

afterEach(() => {
  PostResource.withWrapping();
});

describe('JsonResource', () => {
  it('serialises the raw resource by default', () => {
    expect(new JsonResource(post()).toArray()).toEqual(post().toObject());
    expect(new JsonResource(post()).resolve()).toEqual(post().toObject());
  });

  it('keeps toArray() as the raw declared field list, markers and all', () => {
    const fields: any = new PostResource(post()).toArray();

    expect(fields.title).toBe('Hello');
    expect(fields.author).toBe(MISSING_VALUE);
    expect(new PostResource(post()).resolve()).not.toHaveProperty('author');
  });

  it('renders the fields its toArray declares', () => {
    const resource = new PostResource(post({ published: 1 }));

    expect(resource.resolve()).toEqual({
      id: 1,
      title: 'Hello',
      body: 'hidden',
      state: 'published',
    });
  });

  it('applies `when` with the request', () => {
    const resource = new PostResource(post());

    expect(resource.resolve({ showBody: true }).body).toBe('World');
    expect(resource.resolve({}).body).toBe('hidden');
  });

  it('drops fields whose condition failed without a default', () => {
    const resource = new PostResource(post());

    expect(resource.resolve()).not.toHaveProperty('author');
    expect(resource.resolve()).not.toHaveProperty('comments_count');
    expect(resource.resolve()).not.toHaveProperty('edited_at');
  });

  it('includes loaded relations through whenLoaded', () => {
    const model = post();
    model.setRelation('author', new User({ id: 7, name: 'Ada' }, true));

    const resource = new PostResource(model);

    expect(resource.resolve().author).toEqual({ id: 7, name: 'Ada' });
  });

  it('leaves unloaded relations out of the payload', () => {
    const resource = new PostResource(post());

    expect(resource.resolve()).not.toHaveProperty('author');
  });

  it('hands whenLoaded collections to nested serialisation', () => {
    class FeedResource extends JsonResource {
      toArray(): Record<string, any> {
        return { posts: this.whenLoaded('posts') };
      }
    }

    const model = post();
    model.setRelation('posts', new EnsembleCollection([post({ id: 2, title: 'Second' })]));

    expect(new FeedResource(model).resolve()).toEqual({
      posts: [{ id: 2, title: 'Second', body: 'World', published: 0 }],
    });
  });

  it('walks dotted paths in whenLoaded hop by hop', () => {
    class Profile extends Ensemble {
      static fillable: string[] = ['user_id', 'bio'];

      getTable(): string {
        return 'profiles';
      }
    }

    class NestedResource extends JsonResource {
      toArray(): any {
        return {
          profile: this.whenLoaded('author.profile'),
          author: this.whenLoaded('author'),
        };
      }
    }

    const model = post();
    const user = new User({ id: 7, name: 'Ada' }, true);

    // The first hop is loaded, the second is not: the nested field drops
    expect(new NestedResource(model).resolve()).toEqual({});

    model.setRelation('author', user);
    expect(new NestedResource(model).resolve()).toEqual({ author: { id: 7, name: 'Ada' } });

    user.setRelation('profile', new Profile({ id: 3, user_id: 7, bio: 'Mathematician' }, true));

    // The nested profile rides along inside the author's own serialisation,
    // the way loaded relations always do
    expect(new NestedResource(model).resolve()).toEqual({
      profile: { id: 3, user_id: 7, bio: 'Mathematician' },
      author: { id: 7, name: 'Ada', profile: { id: 3, user_id: 7, bio: 'Mathematician' } },
    });
  });

  it('exposes counted aggregates through whenCounted', () => {
    const model = post();
    model.setComputedAttribute('comments_count', '4');

    expect(new PostResource(model).resolve().comments_count).toBe(4);
  });

  it('exposes other eager-loaded aggregates through whenAggregated', () => {
    const model = post();
    model.setComputedAttribute('comments_sum_votes', 12);

    expect(new PostResource(model).resolve().votes).toBe(12);
  });

  it('splices mergeWhen payloads into the parent object', () => {
    const resource = new PostResource(post());

    expect(resource.resolve({ includeEdits: true })).toHaveProperty('edited_at', '2026-01-02');
    expect(resource.resolve({ includeEdits: false })).not.toHaveProperty('edited_at');
  });

  it('accepts closures as conditions and values', () => {
    class ClosureResource extends JsonResource {
      toArray(): any {
        return {
          name: this.when(
            (model: any) => model.getKey() === 1,
            (model: any) => `#${model.getAttribute('title')}`
          ),
        };
      }
    }

    expect(new ClosureResource(post()).resolve()).toEqual({ name: '#Hello' });
  });

  it('merges with() data alongside the payload', () => {
    const resource = new PostResource(post()).with({ meta: { total: 1 } });

    expect(resource.toJSONPayload()).toEqual({
      data: { id: 1, title: 'Hello', body: 'hidden', state: 'draft' },
      meta: { total: 1 },
    });
  });

  it('merges additional() data alongside the payload', () => {
    const resource = new PostResource(post()).additional({ extra: 'x' });

    expect((resource.toJSONPayload() as any).extra).toBe('x');
  });

  it('wraps payloads under the configured data key', () => {
    const payload = new PostResource(post()).toJSONPayload();

    expect(Object.keys(payload)).toEqual(['data']);
    expect((payload as any).data.title).toBe('Hello');
  });

  it('honours a custom wrapping key per resource class', () => {
    class WrappedPostResource extends PostResource {
      protected static wrap: string | null = 'post';
    }

    expect(new WrappedPostResource(post()).toJSONPayload()).toHaveProperty('post');
  });

  it('unwraps withoutWrapping()', () => {
    PostResource.withoutWrapping();

    const payload = new PostResource(post()).toJSONPayload();

    expect(payload).toHaveProperty('title');
    expect(payload).not.toHaveProperty('data');
  });

  it('unwraps per instance', () => {
    const resource = new PostResource(post()).withoutWrapping();

    expect(resource.toJSONPayload()).toHaveProperty('title');
  });

  it('writes a JsonResponse carrying the payload', () => {
    const response = new PostResource(post()).response();

    expect(response.data).toEqual({ data: { id: 1, title: 'Hello', body: 'hidden', state: 'draft' } });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.encoded()).data.title).toBe('Hello');
  });

  it('serialises through toJSON and toJson', () => {
    const resource = new PostResource(post());

    expect(JSON.parse(JSON.stringify({ post: resource })).post.data.title).toBe('Hello');
    expect(JSON.parse(resource.toJson()).data.body).toBe('hidden');
  });

  it('makes resources through the make() factory', () => {
    expect(PostResource.make(post())).toBeInstanceOf(PostResource);
  });
});

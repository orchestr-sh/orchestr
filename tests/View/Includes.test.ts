import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createViewSetup, type ViewTestSetup } from './support';

/**
 * Includes, stacks, once blocks and old-style components.
 */
describe('CompilerEngine includes / components / stacks', () => {
  let setup: ViewTestSetup;

  beforeEach(() => {
    setup = createViewSetup();
  });

  afterEach(() => {
    setup.cleanup();
  });

  const render = (name: string, data: Record<string, unknown> = {}) => setup.factory.make(name, data).render();

  describe('@include family', () => {
    it('@include renders the partial with the current data', async () => {
      setup.put('partials.alert', '<div class="alert">{{ message }}</div>');
      setup.put('pages.host', "before@include('partials.alert')after");

      expect(await render('pages.host', { message: 'Hi' })).toBe('before<div class="alert">Hi</div>after');
    });

    it('@include merges extra data over the parent scope', async () => {
      setup.put('partials.alert', '{{ message }}/{{ extra }}');
      setup.put('pages.host', "@include('partials.alert', ['extra' => 'from-include'])");

      expect(await render('pages.host', { message: 'Hi' })).toBe('Hi/from-include');
    });

    it('@include resolves variables as view names too', async () => {
      setup.put('partials.a', 'A');
      setup.put('partials.b', 'B');
      setup.put('pages.host', '@include($which)');

      expect(await render('pages.host', { which: 'partials.b' })).toBe('B');
    });

    it('@includeIf skips missing views and renders existing ones', async () => {
      setup.put('pages.host', "@includeIf('partials.missing')ok");

      expect(await render('pages.host')).toBe('ok');
    });

    it('@includeWhen / @includeUnless gate on a condition', async () => {
      setup.put('partials.box', '[box]');
      setup.put('pages.host', "@includeWhen($auth, 'partials.box')@includeUnless($auth, 'partials.box')");

      expect(await render('pages.host', { auth: true })).toBe('[box]');
      expect(await render('pages.host', { auth: false })).toBe('[box]');
    });

    it('@includeFirst renders the first view that exists', async () => {
      setup.put('partials.second', 'second');
      setup.put('pages.host', "@includeFirst(['partials.missing', 'partials.second', 'partials.also-missing'])");

      expect(await render('pages.host')).toBe('second');
    });

    it('@includeFirst throws when no candidate exists', async () => {
      setup.put('pages.host', "@includeFirst(['nope.a', 'nope.b'])");

      await expect(render('pages.host')).rejects.toThrow(/None of views/);
    });

    it('@each renders a partial per item with key/value variables', async () => {
      setup.put('partials.item', '<li>{{ key }}={{ item }}</li>');
      setup.put('pages.host', "@each('partials.item', items, 'item', 'key')");

      expect(await render('pages.host', { items: ['a', 'b'] })).toBe('<li>0=a</li><li>1=b</li>');
    });

    it('@each supports an empty view', async () => {
      setup.put('partials.item', '<li>{{ item }}</li>');
      setup.put('partials.none', '<p>nothing</p>');
      setup.put('pages.host', "@each('partials.item', items, 'item', 'key', 'partials.none')");

      expect(await render('pages.host', { items: [] })).toBe('<p>nothing</p>');
      expect(await render('pages.host', { items: ['x'] })).toBe('<li>x</li>');
    });

    it('@each supports the raw| empty form', async () => {
      setup.put('pages.host', "@each('partials.item', items, 'item', 'key', 'raw|<em>empty</em>')");
      setup.put('partials.item', 'i');

      expect(await render('pages.host', { items: [] })).toBe('<em>empty</em>');
    });

    it('@each exposes $loop', async () => {
      setup.put('partials.item', '{{ $loop->iteration }}');
      setup.put('pages.host', "@each('partials.item', items, 'item')");

      expect(await render('pages.host', { items: ['a', 'b'] })).toBe('12');
    });

    it('included views can nest arbitrarily deep', async () => {
      setup.put('partials.three', '3');
      setup.put('partials.two', "2@include('partials.three')");
      setup.put('partials.one', "1@include('partials.two')");
      setup.put('pages.host', "@include('partials.one')");

      expect(await render('pages.host')).toBe('123');
    });
  });

  describe('@component / @slot / @props', () => {
    it('renders the component with a default $slot', async () => {
      setup.put('components.alert', '<div>{{ $slot }}</div>');
      setup.put('pages.host', "@component('components.alert')Boom@endcomponent");

      expect(await render('pages.host')).toBe('<div>Boom</div>');
    });

    it('escapes {{ $slot }} only once (slot content is HTML-safe)', async () => {
      setup.put('components.alert', '<div>{{ $slot }}</div>');
      setup.put('pages.host', "@component('components.alert')<b>rich</b>@endcomponent");

      expect(await render('pages.host')).toBe('<div><b>rich</b></div>');
    });

    it('named @slot blocks become variables in the component', async () => {
      setup.put('components.panel', '<h1>{{ $title }}</h1><p>{{ $slot }}</p>');
      setup.put('pages.host', "@component('components.panel')@slot('title')Hello@endslot Body@endcomponent");

      expect(await render('pages.host')).toBe('<h1>Hello</h1><p> Body</p>');
    });

    it('@props defaults fill missing component data', async () => {
      setup.put('components.badge', "@props(['type' => 'info'])<span class=\"badge-{{ $type }}\">{{ $slot }}</span>");
      setup.put('pages.host', "@component('components.badge')New@endcomponent");
      expect(await render('pages.host')).toBe('<span class="badge-info">New</span>');

      setup.put('pages.explicit', "@component('components.badge', ['type' => 'danger'])Boom@endcomponent");
      expect(await render('pages.explicit')).toBe('<span class="badge-danger">Boom</span>');
    });

    it('components do not inherit parent data', async () => {
      setup.put('components.secret', '[{{ $password ?? "none" }}]');
      setup.put('pages.host', "@component('components.secret')@endcomponent");

      expect(await render('pages.host', { password: 'hunter2' })).toBe('[none]');
    });
  });

  describe('stacks', () => {
    it('@push appends to a named stack rendered with @stack', async () => {
      setup.put('partials.widget-a', '@push(\'scripts\')<script src="a.js"></script>@endpush');
      setup.put('partials.widget-b', '@push(\'scripts\')<script src="b.js"></script>@endpush');
      setup.put('pages.host', "HEAD|@include('partials.widget-a')@include('partials.widget-b')@stack('scripts')|TAIL");

      expect(await render('pages.host')).toBe('HEAD|<script src="a.js"></script>\n<script src="b.js"></script>|TAIL');
    });

    it('@prepend puts content at the front of the stack', async () => {
      setup.put('pages.host', "@push('s')second@endpush@prepend('s')first@endprepend[@stack('s')]");

      expect(await render('pages.host')).toBe('[first\nsecond]');
    });

    it('@stack is empty for unknown stacks', async () => {
      setup.put('pages.host', '(@stack("nope"))');

      expect(await render('pages.host')).toBe('()');
    });

    it('pushes reach the extending layout', async () => {
      setup.put('layouts.app', "<head>@stack('styles')</head>@yield('content')");
      setup.put(
        'pages.home',
        "@extends('layouts.app')@push('styles')<style>x</style>@endpush@section('content')body@endsection"
      );

      expect(await render('pages.home')).toBe('<head><style>x</style></head>body');
    });
  });

  describe('@once / @pushOnce', () => {
    it('renders an @once block only a single time per render', async () => {
      setup.put('partials.badge', '@once[BADGE]@endonce');
      setup.put('pages.host', "@include('partials.badge')@include('partials.badge')@include('partials.badge')");

      expect(await render('pages.host')).toBe('[BADGE]');
    });

    it('@once inside a loop emits once', async () => {
      setup.put('pages.host', '@foreach(items as i)@once{{ i }}@endonce-@endforeach');

      expect(await render('pages.host', { items: ['a', 'b'] })).toBe('a--');
    });

    it('@pushOnce dedupes per stack and occurrence', async () => {
      setup.put('partials.asset', "@pushOnce('scripts')<script>chart.js</script>@endpushOnce");
      setup.put('pages.host', "@include('partials.asset')@include('partials.asset')@stack('scripts')");

      expect(await render('pages.host')).toBe('<script>chart.js</script>');
    });

    it('@pushOnce honors explicit ids', async () => {
      setup.put('pages.host', "@pushOnce('s', 'x')1@endpushOnce@pushOnce('s', 'y')2@endpushOnce[@stack('s')]");

      expect(await render('pages.host')).toBe('[1\n2]');
    });
  });

  it('mixes includes, layout inheritance and stacks end to end', async () => {
    setup.put(
      'layouts.app',
      "<title>@yield('title', 'Default')</title>@include('partials.nav')@yield('content')@stack('scripts')"
    );
    setup.put('partials.nav', '<nav>{{ appName }}</nav>');
    setup.put(
      'pages.post',
      "@extends('layouts.app')@section('title', 'Post & Co')@section('content')<article>{{ title }}</article>@push('scripts')<script>init()</script>@endpush@endsection"
    );

    const out = await render('pages.post', { title: 'Hello', appName: 'Orchestr' });
    expect(out).toBe('<title>Post &amp; Co</title><nav>Orchestr</nav><article>Hello</article><script>init()</script>');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createViewSetup, type ViewTestSetup } from './support';

/**
 * Layout inheritance: @extends / @section / @yield / @parent across nested
 * layout chains, plus section variants (@show, @append, @overwrite, inline)
 * and @hasSection / @sectionMissing.
 */
describe('CompilerEngine layouts', () => {
  let setup: ViewTestSetup;

  beforeEach(() => {
    setup = createViewSetup();
  });

  afterEach(() => {
    setup.cleanup();
  });

  const render = (name: string, data: Record<string, unknown> = {}) => setup.factory.make(name, data).render();

  it('renders @extends + @section + @yield', async () => {
    setup.put('layouts.app', "<html><body>@yield('content')</body></html>");
    setup.put('pages.home', "@extends('layouts.app')@section('content')<h1>Home</h1>@endsection");

    expect(await render('pages.home')).toBe('<html><body><h1>Home</h1></body></html>');
  });

  it('uses the @yield default when the child defines nothing', async () => {
    setup.put('layouts.app', "[ @yield('sidebar', 'fallback') ]");
    setup.put('pages.bare', "@extends('layouts.app')");

    expect(await render('pages.bare')).toBe('[ fallback ]');
  });

  it('escapes the @yield default like Blade does', async () => {
    setup.put('layouts.app', "@yield('x', 'a & b')");
    setup.put('pages.bare', "@extends('layouts.app')");

    expect(await render('pages.bare')).toBe('a &amp; b');
  });

  it('supports nested layout chains', async () => {
    setup.put('layouts.root', '<div id="root">@yield(\'main\')</div>');
    setup.put('layouts.middle', "@extends('layouts.root')@section('main')<main>@yield('content')</main>@endsection");
    setup.put('pages.deep', "@extends('layouts.middle')@section('content')Hello@endsection");

    expect(await render('pages.deep')).toBe('<div id="root"><main>Hello</main></div>');
  });

  it('@parent injects the ancestor section content at its position', async () => {
    setup.put('layouts.app', "<side>@section('side')PARENT@show</side>@yield('content')");
    setup.put('pages.home', "@extends('layouts.app')@section('side')@parent-child@endsection");

    expect(await render('pages.home')).toBe('<side>PARENT-child</side>');
  });

  it('@parent chains through three levels of layouts', async () => {
    setup.put('layouts.root', "[ @section('c')ROOT@show ]");
    setup.put('layouts.middle', "@extends('layouts.root')@section('c')MIDDLE@parent@endsection");
    setup.put('pages.child', "@extends('layouts.middle')@section('c')CHILD-@parent@endsection");

    expect(await render('pages.child')).toBe('[ CHILD-MIDDLEROOT ]');
  });

  it('strips @parent when no ancestor defines the section', async () => {
    setup.put('layouts.app', "@yield('c')");
    setup.put('pages.home', "@extends('layouts.app')@section('c')@parent only@endsection");

    expect(await render('pages.home')).toBe(' only');
  });

  it('child @endsection replaces the parent section definition', async () => {
    setup.put('layouts.app', "@section('c')LAYOUT@endsection@yield('c')");
    setup.put('pages.home', "@extends('layouts.app')@section('c')PAGE@endsection");

    // The layout yields the replaced (page) content; its own definition does
    // not win because the page already claimed the section.
    expect(await render('pages.home')).toBe('PAGE');
  });

  it('@append concatenates after the existing section content', async () => {
    setup.put('pages.multi', "@section('a')one@endsection@section('a')two@append[@yield('a')]");

    expect(await render('pages.multi')).toBe('[onetwo]');
  });

  it('@overwrite replaces the accumulated section content', async () => {
    setup.put('pages.multi', "@section('a')one@endsection@section('a')two@overwrite[@yield('a')]");

    expect(await render('pages.multi')).toBe('[two]');
  });

  it('captures inline @section(name, value) with escaping', async () => {
    setup.put('layouts.app', "<title>@yield('title')</title>");
    setup.put('pages.home', "@extends('layouts.app')@section('title', 'Tom & Jerry <3')");

    expect(await render('pages.home')).toBe('<title>Tom &amp; Jerry &lt;3</title>');
  });

  it('@stop behaves like @endsection and @show yields in place', async () => {
    setup.put('layouts.app', "@section('a')shown@show(stop)");
    setup.put('pages.plain', "@include('layouts.app')");

    expect(await render('pages.plain')).toBe('shown(stop)');
  });

  it('@hasSection / @sectionMissing branch on child sections', async () => {
    setup.put('layouts.app', "@hasSection('nav')YES@else NO@endif|@sectionMissing('foot')MISSING@endif");
    setup.put('pages.with', "@extends('layouts.app')@section('nav')N@endsection");
    setup.put('pages.without', "@extends('layouts.app')");

    expect(await render('pages.with')).toBe('YES|MISSING');
    expect(await render('pages.without')).toBe(' NO|MISSING');
  });

  it('sections evaluate in the scope that defined them', async () => {
    setup.put('layouts.app', "@yield('content')");
    setup.put(
      'pages.home',
      "@extends('layouts.app')@section('content'){{ $message }} @php $message = \"later\" @endphp {{ $message }}@endsection"
    );

    // The whole section body renders at capture time, sequentially (note the
    // literal spaces around the @php block).
    expect(await render('pages.home', { message: 'first' })).toBe('first  later');
  });

  it('@extends can pass extra data to the layout', async () => {
    setup.put('layouts.app', '{{ $title }}/{{ $sharedVar }}');
    setup.put('pages.home', "@extends('layouts.app', ['title' => 'Custom'])@php $sharedVar = \"kept\" @endphp");

    expect(await render('pages.home')).toBe('Custom/kept');
  });

  it('renders sections containing loops and conditionals', async () => {
    setup.put('layouts.app', "@yield('content')");
    setup.put(
      'pages.home',
      "@extends('layouts.app')@section('content')@if($ok)@foreach(items as i)<b>{{ i }}</b>@endforeach@else nope@endif@endsection"
    );

    expect(await render('pages.home', { ok: true, items: [1, 2] })).toBe('<b>1</b><b>2</b>');
    expect(await render('pages.home', { ok: false, items: [1, 2] })).toBe(' nope');
  });
});

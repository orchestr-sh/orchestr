import { describe, it, expect } from 'vitest';
import {
  abort,
  abort_if,
  abort_unless,
  AccessDeniedHttpException,
  AuthenticationException,
  HttpException,
  ModelNotFoundException,
  NotFoundHttpException,
} from '@/Foundation/Exceptions';

describe('HttpException', () => {
  it('carries the status, message and headers', () => {
    const exception = new HttpException(423, 'Locked', { 'X-Reason': 'still editing' });

    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe('HttpException');
    expect(exception.status).toBe(423);
    expect(exception.getStatus()).toBe(423);
    expect(exception.message).toBe('Locked');
    expect(exception.getHeader('X-Reason')).toBe('still editing');
  });

  it('falls back to the status reason phrase when no message is given', () => {
    expect(new HttpException(500).message).toBe('Internal Server Error');
    expect(new HttpException(404).message).toBe('Not Found');
    expect(new HttpException(418).message).toBe("I'm a teapot");
  });

  it('getHeaders returns a copy, fluent header setters mutate the exception', () => {
    const exception = new HttpException(500, 'boom');

    exception.withHeader('X-A', '1').withHeaders({ 'X-B': '2' });

    expect(exception.getHeaders()).toEqual({ 'X-A': '1', 'X-B': '2' });
    expect(exception.getHeaders()).not.toBe(exception.headers);
  });

  it('the dedicated subclasses preset status and default message', () => {
    expect(new NotFoundHttpException().getStatus()).toBe(404);
    expect(new NotFoundHttpException().message).toBe('Not Found');
    expect(new NotFoundHttpException('User not found').message).toBe('User not found');

    expect(new AccessDeniedHttpException().getStatus()).toBe(403);
    expect(new AccessDeniedHttpException().message).toBe('This action is unauthorized.');

    expect(new AuthenticationException().getStatus()).toBe(401);
    expect(new AuthenticationException().message).toBe('Unauthenticated.');

    expect(new ModelNotFoundException('gone').getStatus()).toBe(404);
  });

  it('subclasses remain instanceof Error for every layer', () => {
    const notFound = new NotFoundHttpException();
    const denied = new AccessDeniedHttpException();
    const unauthenticated = new AuthenticationException();

    expect(notFound).toBeInstanceOf(HttpException);
    expect(denied).toBeInstanceOf(HttpException);
    expect(unauthenticated).toBeInstanceOf(HttpException);
    expect(notFound).toBeInstanceOf(Error);
    expect(notFound.name).toBe('NotFoundHttpException');
    expect(denied.name).toBe('AccessDeniedHttpException');
    expect(unauthenticated.name).toBe('AuthenticationException');
  });
});

describe('abort()', () => {
  it('throws a NotFoundHttpException for 404', () => {
    expect(() => abort(404)).toThrowError(NotFoundHttpException);
    expect(() => abort(404, 'Post not found')).toThrow('Post not found');

    try {
      abort(404);
    } catch (error) {
      expect((error as NotFoundHttpException).getStatus()).toBe(404);
    }
  });

  it('throws AccessDeniedHttpException for 403 and AuthenticationException for 401', () => {
    expect(() => abort(403)).toThrowError(AccessDeniedHttpException);
    expect(() => abort(401)).toThrowError(AuthenticationException);
  });

  it('throws a plain HttpException for other statuses, preserving headers', () => {
    try {
      abort(422, 'nope', { 'X-Hint': 'retry later' });
      expect.unreachable('abort() should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect(error).not.toBeInstanceOf(NotFoundHttpException);
      expect((error as HttpException).getStatus()).toBe(422);
      expect((error as HttpException).message).toBe('nope');
      expect((error as HttpException).getHeader('X-Hint')).toBe('retry later');
    }
  });
});

describe('abort_if() / abort_unless()', () => {
  it('abort_if throws when the condition is truthy', () => {
    expect(() => abort_if(true, 403)).toThrowError(AccessDeniedHttpException);
    expect(() => abort_if(1 === 1, 404, 'missing')).toThrowError(NotFoundHttpException);
    expect(() => abort_if(false, 404)).not.toThrow();
  });

  it('abort_unless throws unless the condition is truthy', () => {
    expect(() => abort_unless(false, 403)).toThrowError(AccessDeniedHttpException);
    expect(() => abort_unless(0, 401, 'sign in')).toThrowError(AuthenticationException);
    expect(() => abort_unless(true, 404)).not.toThrow();
  });

  it('passes status messages and headers through to the exception', () => {
    try {
      abort_if('yes', 423, 'Locked', { 'X-Reason': 'lease' });
      expect.unreachable('abort_if() should throw');
    } catch (error) {
      expect((error as HttpException).message).toBe('Locked');
      expect((error as HttpException).getHeader('X-Reason')).toBe('lease');
    }
  });
});

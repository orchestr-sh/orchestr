/**
 * Generator stubs
 *
 * One place for every `make:*` template. A stub is addressed by name; the
 * `Stub` renderer replaces its `{{ placeholder }}` tokens, and published
 * application stubs (`stubs/<name>.stub` at the project root) override
 * whatever is registered here. Adding a generator means adding a stub file
 * plus its entry below and in the command manifest - never editing a
 * switch (OCP).
 */

import castStub from './cast.stub';
import channelStub from './channel.stub';
import classStub from './class.stub';
import collectionStub from './collection.stub';
import commandStub from './command.stub';
import createTableStub from './create-table.stub';
import enumStub from './enum.stub';
import exceptionStub from './exception.stub';
import factoryPendingStub from './factory-pending.stub';
import factoryStub from './factory.stub';
import interfaceStub from './interface.stub';
import mailStub from './mail.stub';
import middlewareStub from './middleware.stub';
import migrationStub from './migration.stub';
import modelPivotStub from './model-pivot.stub';
import modelStub from './model.stub';
import notificationStub from './notification.stub';
import observerStub from './observer.stub';
import policyStub from './policy.stub';
import providerStub from './provider.stub';
import requestStub from './request.stub';
import resourceStub from './resource.stub';
import ruleStub from './rule.stub';
import seederStub from './seeder.stub';
import testStub from './test.stub';
import traitStub from './trait.stub';
import updateTableStub from './update-table.stub';

/**
 * Built-in stub templates keyed by the name generators address them by.
 */
export const BUILT_IN_STUBS: Readonly<Record<string, string>> = {
  cast: castStub,
  channel: channelStub,
  class: classStub,
  collection: collectionStub,
  command: commandStub,
  'create-table': createTableStub,
  enum: enumStub,
  exception: exceptionStub,
  factory: factoryStub,
  'factory-pending': factoryPendingStub,
  interface: interfaceStub,
  mail: mailStub,
  middleware: middlewareStub,
  migration: migrationStub,
  model: modelStub,
  'model-pivot': modelPivotStub,
  notification: notificationStub,
  observer: observerStub,
  policy: policyStub,
  provider: providerStub,
  request: requestStub,
  resource: resourceStub,
  rule: ruleStub,
  seeder: seederStub,
  test: testStub,
  trait: traitStub,
  'update-table': updateTableStub,
};

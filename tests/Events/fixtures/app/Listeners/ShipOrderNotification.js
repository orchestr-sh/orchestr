/**
 * Fixture listener for the EventDiscovery integration tests.
 *
 * Written as plain ESM JavaScript so the discovery scanner can import it
 * without a transform step. The `design:paramtypes` metadata line reproduces
 * what `emitDecoratorMetadata` writes for a TypeScript `handle(event: OrderShipped)`
 * signature, which is how discovery learns the event a listener belongs to.
 */

class OrderShipped {
  constructor(orderId) {
    this.orderId = orderId;
  }
}

export default class ShipOrderNotification {
  handle(event) {
    return `sent:${event.orderId}`;
  }
}

Reflect.defineMetadata('design:paramtypes', [OrderShipped], ShipOrderNotification.prototype, 'handle');

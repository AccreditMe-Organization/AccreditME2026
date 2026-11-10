/**
 * ACC-288 — for specs proving that a refused change wrote nothing outside its
 * transaction. Makes `prisma.$transaction(cb)` run `cb` against a proxy of the
 * same mock that records every write made THROUGH it ("user.update",
 * "orgUnitHeadEvent.create"…). A spec then compares each write mock's call
 * count with the writes recorded: equal means every write went through the
 * transaction, so a refusal thrown inside it rolls all of them back.
 */
const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

type Mockable = { mockImplementation(fn: (cb: (tx: unknown) => unknown) => unknown): unknown };

export function recordTransactionWrites(prisma: object & { $transaction: Mockable }): string[] {
  const writes: string[] = [];
  const tx = new Proxy(prisma, {
    get(target, model) {
      const delegate: unknown = Reflect.get(target, model);
      if (typeof model !== 'string' || !delegate || typeof delegate !== 'object') return delegate;
      return new Proxy(delegate, {
        get(inner, method) {
          const fn: unknown = Reflect.get(inner, method);
          if (typeof method !== 'string' || typeof fn !== 'function' || !WRITES.has(method)) return fn;
          return (...args: unknown[]) => {
            writes.push(`${model}.${method}`);
            return (fn as (...a: unknown[]) => unknown).apply(inner, args);
          };
        },
      });
    },
  });
  prisma.$transaction.mockImplementation((cb) => cb(tx));
  return writes;
}

/** How many times `write` ("user.update") was recorded inside the transaction. */
export function countWrites(writes: readonly string[], write: string): number {
  return writes.filter((w) => w === write).length;
}

import { ExtractionBusyError, ExtractionSlots } from './extraction-slots';

describe('ExtractionSlots (ACC-193 §14.1)', () => {
  it('gives out up to `size` slots at once', async () => {
    const slots = new ExtractionSlots(2);
    await slots.acquire(Date.now() + 1000);
    await slots.acquire(Date.now() + 1000);
    expect(slots.active).toBe(2);
  });

  it('a third waits, and gets the first slot given back', async () => {
    const slots = new ExtractionSlots(2);
    const release = await slots.acquire(Date.now() + 1000);
    await slots.acquire(Date.now() + 1000);
    const third = slots.acquire(Date.now() + 1000);
    release();
    await expect(third).resolves.toEqual(expect.any(Function));
    expect(slots.active).toBe(2);
  });

  it('a third with no slot by its deadline is refused busy, and leaves no waiter behind', async () => {
    const slots = new ExtractionSlots(1);
    const release = await slots.acquire(Date.now() + 1000);
    await expect(slots.acquire(Date.now() + 50)).rejects.toBeInstanceOf(ExtractionBusyError);
    release();
    expect(slots.active).toBe(0);
  });

  it('releasing twice gives back one slot, not two', async () => {
    const slots = new ExtractionSlots(1);
    const release = await slots.acquire(Date.now() + 1000);
    release();
    release();
    expect(slots.active).toBe(0);
    await slots.acquire(Date.now() + 1000);
    expect(slots.active).toBe(1);
  });
});

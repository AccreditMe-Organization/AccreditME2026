import { SYSTEM_LOOKUP_SEED } from '../lookup/lookup.seed';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SEAT_ACTIONS,
  SEAT_ACTION_DEFAULT_ATTRIBUTE,
  SEAT_ACTION_KEYS,
  SeatActionRefusal,
  canonicalSeatActions,
  copyDefaultSeatActions,
  defaultActionsOf,
  isSeatAction,
  normaliseSeatActions,
  seatActionMap,
  sameSeatActions,
  seatActionWanted,
  seatActionsFor,
} from './seat-actions';

// ACC-283 PR 1 — the seat-action list, the seat defaults on the lookup seed,
// and the one reader. The real reads and writes (the override merge, the save's
// rules, the backfill) are proved against Postgres in
// committee-seat-actions.db-spec.ts.

const ORG_A = 'cmtr9x7zq0000ocp1am2rs14o';
const ORG_B = 'cmtr9x80q0001ocp1bq3kd2rz';
const ARABIC = /[؀-ۿ]/;

const seatCategory = SYSTEM_LOOKUP_SEED.find((c) => c.key === 'committee_member_role')!;
const properties = (seatCategory.attributeSchema?.['properties'] ?? {}) as Record<string, Record<string, unknown>>;
const seedValue = (key: string) => seatCategory.values.find((v) => v.key === key)!;

describe('Seat actions (ACC-283)', () => {
  describe('the fixed list', () => {
    it('is the seven actions, in the order a screen lists them (ACC-316 added the two meeting actions)', () => {
      expect(SEAT_ACTION_KEYS).toEqual([
        'add_member',
        'remove_member',
        'change_member_seat',
        'request_change',
        'decide_reporting_changes',
        'schedule_meeting',
        'record_minutes',
      ]);
      expect(Object.values(SEAT_ACTIONS).sort()).toEqual([...SEAT_ACTION_KEYS].sort());
    });

    it('knows its own keys and nothing else', () => {
      for (const key of SEAT_ACTION_KEYS) expect(isSeatAction(key)).toBe(true);
      expect(isSeatAction('approve_minutes')).toBe(false);
      expect(isSeatAction('change_member_role')).toBe(false);
    });
  });

  describe('the defaults on the seat lookup', () => {
    it.each(SEAT_ACTION_KEYS.map((a) => [a, SEAT_ACTION_DEFAULT_ATTRIBUTE[a]] as const))(
      '%s is the boolean attribute %s, named in both languages',
      (_action, attribute) => {
        const def = properties[attribute]!;
        expect(def).toBeDefined();
        expect(def['type']).toBe('boolean');
        expect(typeof def['labelEn']).toBe('string');
        expect((def['labelEn'] as string).trim()).not.toBe('');
        expect(def['labelAr']).toMatch(ARABIC);
        // The old single `label` is gone: the value form reads labelEn / labelAr (ACC-310).
        expect(def).not.toHaveProperty('label');
      },
    );

    it('the names are the ones lane B gave (16 Nov)', () => {
      const names = Object.fromEntries(
        Object.values(SEAT_ACTION_DEFAULT_ATTRIBUTE).map((a) => [a, [properties[a]!['labelEn'], properties[a]!['labelAr']]]),
      );
      expect(names).toEqual({
        seatAddsMember: ['Add members', 'إضافة أعضاء'],
        seatRemovesMember: ['Remove members', 'إزالة أعضاء'],
        seatChangesSeat: ["Change a member's seat", 'تغيير مقعد عضو'],
        seatRequestsChange: ['Request a change', 'طلب تغيير'],
        seatDecidesReportingChanges: ['Decide changes of committees that report to it', 'البتّ في تغييرات اللجان التابعة لها'],
        // ACC-316
        seatSchedulesMeetings: ['Schedule meetings', 'جدولة الاجتماعات'],
        seatRecordsMinutes: ['Record the minutes', 'تسجيل المحضر'],
      });
    });

    it("Q10's defaults, and ACC-316's: Chairman all but record_minutes, Secretary the member actions and both meeting actions, every other seat none", () => {
      const defaults = Object.fromEntries(seatCategory.values.map((v) => [v.key, defaultActionsOf((v.attributes ?? {}) as Record<string, unknown>)]));
      expect(defaults).toEqual({
        chairman: ['add_member', 'remove_member', 'change_member_seat', 'request_change', 'decide_reporting_changes', 'schedule_meeting'],
        vice_chairman: [],
        secretary: ['add_member', 'remove_member', 'change_member_seat', 'request_change', 'schedule_meeting', 'record_minutes'],
        member: [],
        observer: [],
        advisor: [],
      });
    });

    it('keeps the required seats as ACC-286 set them', () => {
      expect(seedValue('chairman').attributes).toEqual(expect.objectContaining({ required: true }));
      expect(seedValue('secretary').attributes).toEqual(expect.objectContaining({ required: true }));
    });
  });

  describe('defaultActionsOf()', () => {
    it('takes an action only when its attribute is exactly true', () => {
      expect(defaultActionsOf({ seatAddsMember: true, seatRemovesMember: 'true', seatChangesSeat: 1, seatRequestsChange: false })).toEqual(['add_member']);
      expect(defaultActionsOf({})).toEqual([]);
    });
  });

  describe('normaliseSeatActions()', () => {
    it('refuses an action not on the list, naming it', () => {
      let thrown: unknown;
      try {
        normaliseSeatActions([{ roleValueId: 'seat-1', actions: ['add_member', 'approve_minutes'] }]);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SeatActionRefusal);
      expect((thrown as SeatActionRefusal).getStatus()).toBe(400);
      expect((thrown as SeatActionRefusal).getResponse()).toEqual(
        expect.objectContaining({ code: 'SEAT_ACTION_UNKNOWN', actionKey: 'approve_minutes', statusCode: 400 }),
      );
    });

    it('a seat named twice is the union; an empty list is kept (the seat allows nothing)', () => {
      const out = normaliseSeatActions([
        { roleValueId: 'seat-1', actions: ['add_member'] },
        { roleValueId: 'seat-2', actions: [] },
        { roleValueId: 'seat-1', actions: ['request_change', 'add_member'] },
      ]);
      expect([...out.entries()].map(([k, v]) => [k, [...v].sort()])).toEqual([
        ['seat-1', ['add_member', 'request_change']],
        ['seat-2', []],
      ]);
    });
  });

  describe('seatActionMap()', () => {
    it('groups by seat, in seat-id order, each seat in list order', () => {
      expect(
        seatActionMap([
          { roleValueId: 'b', actionKey: 'decide_reporting_changes' },
          { roleValueId: 'a', actionKey: 'request_change' },
          { roleValueId: 'b', actionKey: 'add_member' },
        ]),
      ).toEqual({ a: ['request_change'], b: ['add_member', 'decide_reporting_changes'] });
    });
  });

  describe('seatActionsFor() — the one reader', () => {
    const reader = () => {
      const findMany = jest.fn().mockResolvedValue([]);
      return { client: { committeeSeatAction: { findMany } } as unknown as PrismaService, findMany };
    };

    it('reads nothing for no committees', async () => {
      const { client, findMany } = reader();
      expect(await seatActionsFor(client, ORG_A, [])).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('one query for every committee asked, optionally one action', async () => {
      const { client, findMany } = reader();
      await seatActionsFor(client, ORG_A, ['c-1', 'c-2'], SEAT_ACTIONS.DECIDE_REPORTING_CHANGES);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
        committeeId: { in: ['c-1', 'c-2'] },
        actionKey: 'decide_reporting_changes',
      });
    });

    itEnforcesTenantIsolation('seatActionsFor — the query is bound to the organisation', async () => {
      const { client, findMany } = reader();
      await seatActionsFor(client, ORG_A, ['c-1']);
      const where = findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(JSON.stringify(where)).not.toContain(ORG_B);
    });
  });

  describe('copyDefaultSeatActions()', () => {
    it("writes the organisation's defaults for the committee, scoped to the organisation, and returns them", async () => {
      const createMany = jest.fn().mockResolvedValue({ count: 2 });
      const $queryRaw = jest.fn().mockResolvedValue([
        { id: 'seat-chair', key: 'chairman', labelEn: 'Chairman', labelAr: null, attributes: { seatAddsMember: true, seatDecidesReportingChanges: true } },
        { id: 'seat-member', key: 'member', labelEn: 'Member', labelAr: null, attributes: { seatAddsMember: false } },
      ]);
      const tx = { $queryRaw, committeeSeatAction: { createMany } } as unknown as PrismaService;

      expect(await copyDefaultSeatActions(tx, ORG_A, 'c-1')).toEqual([
        { roleValueId: 'seat-chair', actionKey: 'add_member' },
        { roleValueId: 'seat-chair', actionKey: 'decide_reporting_changes' },
      ]);
      expect(createMany.mock.calls[0][0].data).toEqual([
        { organizationId: ORG_A, committeeId: 'c-1', roleValueId: 'seat-chair', actionKey: 'add_member' },
        { organizationId: ORG_A, committeeId: 'c-1', roleValueId: 'seat-chair', actionKey: 'decide_reporting_changes' },
      ]);
      expect($queryRaw.mock.calls[0]).toContain(ORG_A);
    });

    it('writes nothing when no seat allows anything by default', async () => {
      const createMany = jest.fn();
      const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 's', key: 'member', labelEn: 'Member', labelAr: null, attributes: {} }]), committeeSeatAction: { createMany } } as unknown as PrismaService;
      expect(await copyDefaultSeatActions(tx, ORG_A, 'c-1')).toEqual([]);
      expect(createMany).not.toHaveBeenCalled();
    });
  });
});

// ACC-283 PR 5 — a change request's seat-action map: canonical, checked, compared.
describe('Seat actions in a change request (ACC-283 PR 5)', () => {
  const used = new Set(['seat-a', 'seat-b']);

  it('makes a proposed map canonical: seats sorted, actions in the list order, an empty seat left out, a seat named twice merged', () => {
    expect(
      canonicalSeatActions(
        [
          { roleValueId: 'seat-b', actions: ['decide_reporting_changes', 'add_member'] },
          { roleValueId: 'seat-a', actions: [] },
          { roleValueId: 'seat-b', actions: ['request_change'] },
        ],
        used,
      ),
    ).toEqual({ 'seat-b': ['add_member', 'request_change', 'decide_reporting_changes'] });
  });

  it('refuses an action off the list and a seat the organisation does not use', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return 'OK';
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(code(() => canonicalSeatActions([{ roleValueId: 'seat-a', actions: ['fly'] }], used))).toBe('SEAT_ACTION_UNKNOWN');
    expect(code(() => canonicalSeatActions([{ roleValueId: 'seat-z', actions: ['add_member'] }], used))).toBe('SEAT_ACTION_SEAT_UNKNOWN');
  });

  it('compares canonical maps as values, and an absent map as empty', () => {
    expect(sameSeatActions({ a: ['add_member'] }, { a: ['add_member'] })).toBe(true);
    expect(sameSeatActions({ a: ['add_member'] }, { a: ['remove_member'] })).toBe(false);
    expect(sameSeatActions({}, undefined)).toBe(true);
    expect(sameSeatActions({ a: ['add_member'] }, null)).toBe(false);
  });

  it('turns a canonical map into what the writer takes', () => {
    expect(seatActionWanted({ a: ['add_member', 'request_change'] })).toEqual(new Map([['a', new Set(['add_member', 'request_change'])]]));
  });
});

import type { Job } from 'bullmq';
import { WorkflowActionProcessor } from './workflow-action.processor';
import type { PrismaService } from '../../prisma/prisma.service';
import { auditSecretsOf, headerChanges, maskActionConfig, mergeActionConfig } from './webhook-config-secrets';

/**
 * ACC-277 — the pure rules for a transition action's secrets, and the proof the
 * webhook sender is unaffected: a masked read sent back unchanged leaves the
 * outgoing request's headers exactly as they were. The marker is synthetic test
 * data, never a real secret.
 */

const MARKER = 'acc277-test-marker-value';
const STORED = {
  webhookUrl: 'https://hooks.example.test/in',
  timeoutMs: 5000,
  headers: { Authorization: `Bearer ${MARKER}-auth`, 'X-Api-Key': `${MARKER}-key` },
  signingSecret: `${MARKER}-signing`,
};
const leaks = (value: unknown): boolean => JSON.stringify(value ?? null).includes(MARKER);

describe('webhook action secrets (ACC-277)', () => {
  describe('maskActionConfig', () => {
    it('returns every header by name with "" and whether it is set, and the signing secret as "" with whether it is set', () => {
      const masked = maskActionConfig({ ...STORED, headers: { ...STORED.headers, Empty: '' } });
      expect(leaks(masked)).toBe(false);
      expect(masked).toEqual({
        webhookUrl: STORED.webhookUrl,
        timeoutMs: 5000,
        headers: { Authorization: '', 'X-Api-Key': '', Empty: '' },
        headersValueSet: { Authorization: true, 'X-Api-Key': true, Empty: false },
        signingSecret: '',
        signingSecretSet: true,
      });
    });

    it('never mutates the stored config', () => {
      const stored = structuredClone(STORED);
      maskActionConfig(stored);
      expect(stored).toEqual(STORED);
    });

    it('a header map that is not name → string is still masked, never echoed', () => {
      expect(leaks(maskActionConfig({ headers: { A: { nested: MARKER } } }))).toBe(false);
      expect(maskActionConfig({ headers: [MARKER] })).toEqual({ headers: {}, headersValueSet: {} });
    });

    it('leaves a config without secrets as it is, and null as null', () => {
      expect(maskActionConfig({ webhookUrl: 'u' })).toEqual({ webhookUrl: 'u' });
      expect(maskActionConfig(null)).toBeNull();
    });

    it('drops read-only markers a stored config should never hold', () => {
      expect(maskActionConfig({ webhookUrl: 'u', headersValueSet: { X: true } })).toEqual({ webhookUrl: 'u' });
    });
  });

  describe('mergeActionConfig', () => {
    it('empty keeps, a value replaces, left out removes, new is added', () => {
      const merged = mergeActionConfig(STORED, {
        webhookUrl: 'https://hooks.example.test/next',
        headers: { Authorization: '', 'X-New': 'fresh', 'X-Blank': '  ' },
        signingSecret: '',
      });
      expect(merged).toEqual({
        webhookUrl: 'https://hooks.example.test/next',
        headers: { Authorization: STORED.headers.Authorization, 'X-New': 'fresh', 'X-Blank': '' },
        signingSecret: STORED.signingSecret,
      });
    });

    it('a null value, like an empty one, keeps the stored value', () => {
      expect(mergeActionConfig(STORED, { headers: { Authorization: null } })['headers']).toEqual({ Authorization: STORED.headers.Authorization });
    });

    it('no header list removes them all; no signing secret removes it; an empty one with nothing stored stays out', () => {
      expect(mergeActionConfig(STORED, { webhookUrl: 'u' })).toEqual({ webhookUrl: 'u' });
      expect(mergeActionConfig({ webhookUrl: 'u' }, { webhookUrl: 'u', signingSecret: '' })).toEqual({ webhookUrl: 'u' });
    });

    it('never stores the read-only markers', () => {
      expect(mergeActionConfig(null, { webhookUrl: 'u', headersValueSet: { A: true }, signingSecretSet: true })).toEqual({ webhookUrl: 'u' });
    });
  });

  describe('what an audit row may say', () => {
    it('header names and whether a signing secret is set, never a value', () => {
      expect(auditSecretsOf(STORED)).toEqual({ headers: ['Authorization', 'X-Api-Key'], signingSecret: 'set' });
      expect(leaks(auditSecretsOf(STORED))).toBe(false);
    });

    it('which headers changed, by name', () => {
      const changes = headerChanges(STORED, { headers: { Authorization: 'other', 'X-New': 'v' } });
      expect(changes).toEqual({ Authorization: 'changed', 'X-New': 'added', 'X-Api-Key': 'removed' });
      expect(leaks(changes)).toBe(false);
    });
  });

  describe('the webhook sender', () => {
    async function sentHeaders(configJson: Record<string, unknown>): Promise<Record<string, string>> {
      const prisma = {
        workflowTransitionAction: { findUnique: jest.fn().mockResolvedValue({ id: 'action-1', configJson }) },
        workflowActionLog: { create: jest.fn() },
      };
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
      const original = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;
      try {
        const processor = new WorkflowActionProcessor(prisma as unknown as PrismaService);
        await processor.process({
          data: { workflowTransitionActionId: 'action-1', workflowInstanceId: 'i-1', organizationId: 'org-a', payload: {} },
          attemptsMade: 0,
          opts: { attempts: 3 },
        } as unknown as Job<never>);
      } finally {
        global.fetch = original;
      }
      return (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    }

    async function logged(configJson: Record<string, unknown>, fetchImpl: jest.Mock) {
      const prisma = {
        workflowTransitionAction: { findUnique: jest.fn().mockResolvedValue({ id: 'action-1', configJson }) },
        workflowActionLog: { create: jest.fn() },
      };
      const original = global.fetch;
      global.fetch = fetchImpl as unknown as typeof fetch;
      let thrown: unknown;
      try {
        await new WorkflowActionProcessor(prisma as unknown as PrismaService).process({
          data: { workflowTransitionActionId: 'action-1', workflowInstanceId: 'i-1', organizationId: 'org-a', payload: {} },
          attemptsMade: 2,
          opts: { attempts: 3 },
        } as unknown as Job<never>);
      } catch (e) {
        thrown = e;
      } finally {
        global.fetch = original;
      }
      return { row: prisma.workflowActionLog.create.mock.calls[0][0].data, thrown };
    }

    it('a fetch error quoting a header value is logged, and rethrown to BullMQ, with the value redacted', async () => {
      const { row, thrown } = await logged(
        STORED,
        jest.fn().mockRejectedValue(new TypeError(`Headers.append: "${STORED.headers.Authorization}" is an invalid header value.`)),
      );
      expect(leaks(row)).toBe(false);
      expect(row.errorMessage).toContain('[redacted]');
      expect(leaks((thrown as Error).message)).toBe(false);
      expect(leaks((thrown as Error).stack)).toBe(false);
    });

    it('a response that echoes a header back is logged with the value redacted', async () => {
      const { row } = await logged(
        STORED,
        jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(`{"echo":"${STORED.headers['X-Api-Key']}"}`) }),
      );
      expect(leaks(row)).toBe(false);
      expect(row.responseSummary).toBe('{"echo":"[redacted]"}');
    });

    it('a masked read sent back unchanged (what the Actions dialog does) leaves the outgoing headers identical', async () => {
      const masked = maskActionConfig(STORED)!;
      // The dialog rebuilds its config from the URL and the headers it showed.
      const resaved = mergeActionConfig(STORED, { webhookUrl: masked['webhookUrl'], headers: masked['headers'] });
      expect(await sentHeaders(resaved)).toEqual(await sentHeaders(STORED));
      expect(await sentHeaders(resaved)).toEqual({ 'Content-Type': 'application/json', ...STORED.headers });
    });
  });
});

import { closedNoticeText, recordLinkTarget, type ClosedNoticeFacts } from './task-closed-notice';

// ACC-271 PR 4 (plan §7) — the four sentences, word for word, in both
// languages. The first three are the plan's table; the fourth is Ahmad's of
// 29 Oct, for a task completed by another assignee (no stage moved).

const base = {
  task: { title: 'Check the terms', titleAr: 'مراجعة الشروط' },
  actorName: 'Dr. Hessa Al-Dosari',
  recordType: 'COMMITTEE',
  record: { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
};
const stage = { nameEn: 'Active', nameAr: 'نشطة' };
const transition = { labelEn: 'Dissolve Committee', labelAr: 'حل اللجنة' };
const text = (f: Partial<ClosedNoticeFacts> & Pick<ClosedNoticeFacts, 'kind'>) => closedNoticeText({ ...base, ...f } as ClosedNoticeFacts);

describe('closedNoticeText (ACC-271 PR 4)', () => {
  describe('to someone who may open the record: it is named', () => {
    it('moved on — a stage decision moved the record', () => {
      expect(text({ kind: 'MOVED', stage })).toEqual({
        en: 'Your task "Check the terms" is closed. Dr. Hessa Al-Dosari approved Quality Committee, so it moved to Active.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط»: انتقلت «لجنة الجودة» إلى «نشطة» باعتماد من Dr. Hessa Al-Dosari.',
      });
    });

    it('sent back — a RETURN', () => {
      expect(text({ kind: 'SENT_BACK', stage: { nameEn: 'Formation', nameAr: 'التكوين' } })).toEqual({
        en: 'Your task "Check the terms" is closed. Quality Committee was sent back to Formation by Dr. Hessa Al-Dosari.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط»: أُعيدت «لجنة الجودة» إلى «التكوين» بقرار من Dr. Hessa Al-Dosari.',
      });
    });

    it('ended — an EXIT', () => {
      expect(text({ kind: 'ENDED', transition })).toEqual({
        en: 'Your task "Check the terms" is closed. Quality Committee was ended (Dissolve Committee) by Dr. Hessa Al-Dosari.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط»: أُنهيت «لجنة الجودة» («حل اللجنة») بقرار من Dr. Hessa Al-Dosari.',
      });
    });

    it('completed by another assignee — no stage moved', () => {
      expect(text({ kind: 'COMPLETED' })).toEqual({
        en: 'Your task "Check the terms" on Quality Committee is closed: Dr. Hessa Al-Dosari completed it.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط» في «لجنة الجودة»: أُنجزت من قِبل Dr. Hessa Al-Dosari.',
      });
    });
  });

  describe("to someone who may not open it: the record's type, never its name", () => {
    it('moved on', () => {
      expect(text({ kind: 'MOVED', stage, record: null })).toEqual({
        en: 'Your task "Check the terms" is closed. Dr. Hessa Al-Dosari approved the committee, so it moved to Active.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط»: انتقلت اللجنة إلى «نشطة» باعتماد من Dr. Hessa Al-Dosari.',
      });
    });

    it('sent back, the type starting its sentence', () => {
      expect(text({ kind: 'SENT_BACK', stage, record: null }).en).toBe(
        'Your task "Check the terms" is closed. The committee was sent back to Active by Dr. Hessa Al-Dosari.',
      );
      expect(text({ kind: 'SENT_BACK', stage, record: null }).ar).toBe(
        'أُغلقت مهمتك «مراجعة الشروط»: أُعيدت اللجنة إلى «نشطة» بقرار من Dr. Hessa Al-Dosari.',
      );
    });

    it('ended', () => {
      expect(text({ kind: 'ENDED', transition, record: null })).toEqual({
        en: 'Your task "Check the terms" is closed. The committee was ended (Dissolve Committee) by Dr. Hessa Al-Dosari.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط»: أُنهيت اللجنة («حل اللجنة») بقرار من Dr. Hessa Al-Dosari.',
      });
    });

    it('completed: "on the committee" in place of its name', () => {
      expect(text({ kind: 'COMPLETED', record: null })).toEqual({
        en: 'Your task "Check the terms" on the committee is closed: Dr. Hessa Al-Dosari completed it.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط» في اللجنة: أُنجزت من قِبل Dr. Hessa Al-Dosari.',
      });
    });

    it('completed, on a record type with nothing to say: "on …" is dropped', () => {
      expect(text({ kind: 'COMPLETED', record: null, recordType: 'DOCUMENT' })).toEqual({
        en: 'Your task "Check the terms" is closed: Dr. Hessa Al-Dosari completed it.',
        ar: 'أُغلقت مهمتك «مراجعة الشروط»: أُنجزت من قِبل Dr. Hessa Al-Dosari.',
      });
    });
  });

  it('falls back to the English names where a task, record, stage or move has no Arabic one', () => {
    const t = text({
      kind: 'ENDED',
      task: { title: 'Check the terms', titleAr: null },
      record: { nameEn: 'Quality Committee', nameAr: null },
      transition: { labelEn: 'Dissolve Committee', labelAr: null },
    });
    expect(t.ar).toBe('أُغلقت مهمتك «Check the terms»: أُنهيت «Quality Committee» («Dissolve Committee») بقرار من Dr. Hessa Al-Dosari.');
  });
});

describe('recordLinkTarget — where "Open record" goes', () => {
  it('a committee opens itself; a change request opens its committee; nothing else has a page yet', () => {
    expect(recordLinkTarget('COMMITTEE', 'c-1', null)).toEqual({ objectType: 'COMMITTEE', objectId: 'c-1' });
    expect(recordLinkTarget('COMMITTEE_CHANGE_REQUEST', 'r-1', 'c-1')).toEqual({ objectType: 'COMMITTEE', objectId: 'c-1' });
    expect(recordLinkTarget('MEETING', 'm-1', null)).toBeNull();
    expect(recordLinkTarget('DOCUMENT', 'd-1', null)).toBeNull();
  });
});

import { recipientsByCommittee, transferNoticeText, type TransferNoticeLine } from './committee-transfer-notice';

// ACC-297 — the notice's words in both languages, and who is told about which committee.

const QUALITY = { nameEn: 'Quality Council', nameAr: 'مجلس الجودة' };
const MEMBER = { nameEn: 'Member', nameAr: 'عضو' };
const SECRETARY = { nameEn: 'Secretary', nameAr: 'أمين السر' };
const PHARMACY_UNIT = { nameEn: 'Pharmacy', nameAr: 'الصيدلية' };

const text = (lines: TransferNoticeLine[], newUnit: { nameEn: string; nameAr: string | null } | null = PHARMACY_UNIT) =>
  transferNoticeText({ personName: 'Sara Al-Mutairi', newUnit, lines });

describe('transferNoticeText (ACC-297)', () => {
  // The bell shows only a notice's title, so the title IS the full sentence, and
  // the body is the same text: the closed-task notices' precedent (live check, 13 Nov).
  it('one committee: the title is the full sentence, in English and Arabic, and the body is the same', () => {
    const t = text([{ kind: 'HOLDS', committee: QUALITY, seat: MEMBER }]);
    expect(t.titleEn).toBe(
      'Sara Al-Mutairi was transferred to Pharmacy. Quality Council: still holds Member. Anyone with "Remove members from a committee" can remove a seat.',
    );
    expect(t.titleAr).toBe(
      'تم نقل Sara Al-Mutairi إلى «الصيدلية». «مجلس الجودة»: ما زالت العضوية بصفة «عضو» قائمة. تتيح صلاحية «إزالة أعضاء من اللجنة» إزالة المقعد.',
    );
    expect(t.bodyEn).toBe(t.titleEn);
    expect(t.bodyAr).toBe(t.titleAr);
  });

  it('several committees: the title is the full sentence with every line, in English and Arabic, and the body is the same', () => {
    const t = text([
      { kind: 'HOLDS', committee: QUALITY, seat: MEMBER },
      { kind: 'REMOVED_IN_TRANSFER', committee: { nameEn: 'Safety Committee', nameAr: 'لجنة السلامة' }, seat: SECRETARY },
      { kind: 'REMOVED_WITH_REASON', committee: null, seat: MEMBER, reason: 'Left for the night roster' },
    ]);
    expect(t.titleEn).toBe(
      'Sara Al-Mutairi was transferred to Pharmacy. Quality Council: still holds Member. ' +
        'Safety Committee: was removed from Secretary as part of the transfer to Pharmacy. ' +
        'A committee: was removed from Member. Reason given: "Left for the night roster". ' +
        'Anyone with "Remove members from a committee" can remove a seat.',
    );
    expect(t.titleAr).toBe(
      'تم نقل Sara Al-Mutairi إلى «الصيدلية». «مجلس الجودة»: ما زالت العضوية بصفة «عضو» قائمة. ' +
        '«لجنة السلامة»: أُنهيت العضوية بصفة «أمين السر» ضمن النقل إلى «الصيدلية». ' +
        'لجنة: أُنهيت العضوية بصفة «عضو». السبب المذكور: «Left for the night roster». ' +
        'تتيح صلاحية «إزالة أعضاء من اللجنة» إزالة المقعد.',
    );
    expect(t.bodyEn).toBe(t.titleEn);
    expect(t.bodyAr).toBe(t.titleAr);
  });

  it('removed as part of the transfer: worded in each language, never the stored reason', () => {
    const t = text([{ kind: 'REMOVED_IN_TRANSFER', committee: QUALITY, seat: SECRETARY }]);
    expect(t.bodyEn).toContain('Quality Council: was removed from Secretary as part of the transfer to Pharmacy.');
    expect(t.bodyAr).toContain('«مجلس الجودة»: أُنهيت العضوية بصفة «أمين السر» ضمن النقل إلى «الصيدلية».');
  });

  it('removed by someone else with a reason: quoted as written, in both languages', () => {
    const t = text([{ kind: 'REMOVED_WITH_REASON', committee: QUALITY, seat: MEMBER, reason: 'Moved to the night roster' }]);
    expect(t.bodyEn).toContain('Quality Council: was removed from Member. Reason given: "Moved to the night roster".');
    expect(t.bodyAr).toContain('«مجلس الجودة»: أُنهيت العضوية بصفة «عضو». السبب المذكور: «Moved to the night roster».');
  });

  it('removed by someone else with no reason: says so', () => {
    const t = text([{ kind: 'REMOVED_NO_REASON', committee: QUALITY, seat: MEMBER }]);
    expect(t.bodyEn).toContain('Quality Council: was removed from Member; no reason was given.');
    expect(t.bodyAr).toContain('«مجلس الجودة»: أُنهيت العضوية بصفة «عضو» دون ذكر سبب.');
  });

  it('a committee the reader may not open is "a committee", in both languages', () => {
    const t = text([{ kind: 'HOLDS', committee: null, seat: MEMBER }]);
    expect(t.bodyEn).toContain('A committee: still holds Member.');
    expect(t.bodyEn).not.toContain('Quality Council');
    expect(t.bodyAr).toContain('لجنة: ما زالت العضوية بصفة «عضو» قائمة.');
    expect(t.bodyAr).not.toContain('مجلس الجودة');
  });

  it('several committees are listed in order, in one notice', () => {
    const t = text([
      { kind: 'HOLDS', committee: QUALITY, seat: MEMBER },
      { kind: 'REMOVED_IN_TRANSFER', committee: { nameEn: 'Safety Committee', nameAr: null }, seat: SECRETARY },
    ]);
    expect(t.bodyEn.indexOf('Quality Council')).toBeLessThan(t.bodyEn.indexOf('Safety Committee'));
    // An Arabic name that is missing falls back to the English one.
    expect(t.bodyAr).toContain('«Safety Committee»');
  });

  it('a person with no unit now: "another unit"', () => {
    const t = text([{ kind: 'HOLDS', committee: QUALITY, seat: MEMBER }], null);
    expect(t.titleEn.startsWith('Sara Al-Mutairi was transferred to another unit. ')).toBe(true);
    expect(t.titleAr.startsWith('تم نقل Sara Al-Mutairi إلى وحدة أخرى. ')).toBe(true);
  });

  it('Arabic has no verb whose subject is the person, and no organisation word', () => {
    const t = text([
      { kind: 'HOLDS', committee: QUALITY, seat: MEMBER },
      { kind: 'REMOVED_IN_TRANSFER', committee: QUALITY, seat: MEMBER },
      { kind: 'REMOVED_WITH_REASON', committee: QUALITY, seat: MEMBER, reason: 'x' },
      { kind: 'REMOVED_NO_REASON', committee: QUALITY, seat: MEMBER },
    ]);
    // The gendered perfect forms a person-subject would need ("he/she was moved / removed").
    for (const gendered of ['نُقل ', 'نُقلت ', 'أُزيل ', 'أُزيلت ', 'لا يزال', 'لا تزال']) expect(t.bodyAr).not.toContain(gendered);
    expect(t.bodyAr).not.toContain('مؤسسة');
  });
});

describe('recipientsByCommittee (ACC-297)', () => {
  const EXCLUDE = { personId: 'person', actorId: 'actor' };

  it("tells each committee's chair, secretary and owning-unit head", () => {
    const told = recipientsByCommittee([{ committeeId: 'c1', officerIds: ['chair', 'secretary'], headIds: ['head'], coverId: null }], EXCLUDE);
    expect([...told.keys()].sort()).toEqual(['chair', 'head', 'secretary']);
  });

  it('tells the cover in force INSTEAD of the head', () => {
    const told = recipientsByCommittee([{ committeeId: 'c1', officerIds: [], headIds: ['head'], coverId: 'cover' }], EXCLUDE);
    expect([...told.keys()]).toEqual(['cover']);
  });

  it('tells both head holders during a handover, and nobody in that role with neither', () => {
    expect([...recipientsByCommittee([{ committeeId: 'c1', officerIds: [], headIds: ['h1', 'h2'], coverId: null }], EXCLUDE).keys()]).toEqual(['h1', 'h2']);
    expect(recipientsByCommittee([{ committeeId: 'c1', officerIds: [], headIds: [], coverId: null }], EXCLUDE).size).toBe(0);
  });

  it('deduplicates across committees: one entry per person, listing each committee once, in order', () => {
    const told = recipientsByCommittee(
      [
        { committeeId: 'c1', officerIds: ['chair'], headIds: ['head'], coverId: null },
        { committeeId: 'c2', officerIds: ['chair', 'head'], headIds: ['head'], coverId: null },
      ],
      EXCLUDE,
    );
    expect(told.get('chair')).toEqual(['c1', 'c2']);
    expect(told.get('head')).toEqual(['c1', 'c2']);
    expect(told.size).toBe(2);
  });

  it('never tells the transferred person or the actor, whatever seat or headship they hold', () => {
    const told = recipientsByCommittee(
      [
        { committeeId: 'c1', officerIds: ['person', 'actor', 'secretary'], headIds: ['actor'], coverId: null },
        { committeeId: 'c2', officerIds: [], headIds: [], coverId: 'person' },
      ],
      EXCLUDE,
    );
    expect([...told.keys()]).toEqual(['secretary']);
  });
});

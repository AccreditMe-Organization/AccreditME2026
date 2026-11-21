import { EMAIL_LABEL, NameTable, normaliseWord, type NameSource } from './meeting-ai-names';

// ACC-322 — names never reach the model as written (plan step-322 §1.0).

const member = (userId: string, name: string, active = true): NameSource => ({ kind: 'MEMBER', userId, name, active });
const orgGuest = (userId: string, name: string): NameSource => ({ kind: 'ORG_GUEST', userId, name, active: true });
const outside = (name: string): NameSource => ({ kind: 'OUTSIDE_GUEST', userId: null, name, active: false });

describe('NameTable (ACC-322)', () => {
  it('replaces an invitee full name, and maps the label back to the same person', () => {
    const t = new NameTable([member('u1', 'Huda Al-Harbi'), member('u2', 'Omar Saleh')], []);
    const sent = t.replace('Huda Al-Harbi will send the figures; Omar Saleh agreed.');
    expect(sent).toBe('[P1] will send the figures; [P2] agreed.');
    expect(t.person('P1')).toEqual(expect.objectContaining({ userId: 'u1', kind: 'MEMBER' }));
    expect(t.person('[P2]')).toEqual(expect.objectContaining({ userId: 'u2' }));
    expect(t.writeBack('Owner: [P2]')).toBe('Owner: Omar Saleh');
  });

  it('hands labels out in order of first appearance, so only the people named are labelled', () => {
    const t = new NameTable([member('u1', 'Huda Al-Harbi'), member('u2', 'Omar Saleh')], []);
    expect(t.replace('Omar first.')).toBe('[P1] first.');
    expect(t.labelsGiven()).toEqual(['[P1]']);
    expect(t.person('P1')!.userId).toBe('u2');
  });

  it('a first name that belongs to exactly one invitee is that invitee', () => {
    const t = new NameTable([member('u1', 'Huda Al-Harbi'), member('u2', 'Omar Saleh')], []);
    expect(t.replace('huda will chase it')).toBe('[P1] will chase it');
  });

  it('a first name two invitees share is NOT replaced on its own (ambiguous)', () => {
    const t = new NameTable([member('u1', 'Omar Saleh'), member('u2', 'Omar Khalid')], []);
    expect(t.replace('Omar will chase it; Omar Khalid agreed.')).toBe('Omar will chase it; [P1] agreed.');
    expect(t.person('P1')!.userId).toBe('u2');
  });

  it("an outside guest's word is ALWAYS the guest's, even when an invitee shares it", () => {
    const t = new NameTable([member('u1', 'Lina Saleh'), outside('د. لينا منصور'), outside('Dr. Lina Mansour')], []);
    // "Lina" is shared with a member, and still replaced: over-replacing is the safe direction.
    const sent = t.replace('Lina presented; Mansour asked a question.');
    expect(sent).not.toMatch(/Lina|Mansour/);
    expect(sent).toMatch(/^\[P\d+\] presented; \[P\d+\] asked a question\.$/);
  });

  it('keeps an honorific outside the label', () => {
    const t = new NameTable([outside('د. لينا منصور')], []);
    expect(t.replace('قدّمت د. لينا منصور العرض')).toBe('قدّمت د. [P1] العرض');
    expect(t.person('P1')).toEqual(expect.objectContaining({ kind: 'OUTSIDE_GUEST', userId: null }));
  });

  it('normalises Arabic: alef forms, ta marbuta, alef maqsura, tatweel and diacritics', () => {
    expect(normaliseWord('أُسامة')).toBe(normaliseWord('اسامه'));
    expect(normaliseWord('مُصطفى')).toBe(normaliseWord('مصطفي'));
    expect(normaliseWord('إيـــمان')).toBe(normaliseWord('ايمان'));
    const t = new NameTable([member('u1', 'أسامة الحربي')], []);
    expect(t.replace('سيتابع اسامه الحربي الموضوع')).toBe('سيتابع [P1] الموضوع');
  });

  it("an active person who is not invited is replaced by full name only", () => {
    const t = new NameTable([member('u1', 'Huda Al-Harbi')], [
      { userId: 'u1', name: 'Huda Al-Harbi' },
      { userId: 'u9', name: 'Fahad Al-Otaibi' },
    ]);
    expect(t.replace('Ask Fahad Al-Otaibi; Fahad alone stays.')).toBe('Ask [P1]; Fahad alone stays.');
    expect(t.person('P1')).toEqual(expect.objectContaining({ kind: 'PERSON', userId: 'u9' }));
  });

  it('an invitee who is also an active person is matched as the invitee', () => {
    const t = new NameTable([orgGuest('u1', 'Huda Al-Harbi')], [{ userId: 'u1', name: 'Huda Al-Harbi' }]);
    t.replace('Huda Al-Harbi');
    expect(t.person('P1')!.kind).toBe('ORG_GUEST');
  });

  it('replaces every email address', () => {
    const t = new NameTable([], []);
    expect(t.replace('Send to huda.h@hospital.sa and lab-team@example.org.')).toBe(`Send to ${EMAIL_LABEL} and ${EMAIL_LABEL}.`);
  });

  it('matches whole words only, ignoring case', () => {
    const t = new NameTable([member('u1', 'Ali Hassan')], []);
    expect(t.replace('ALI said; Alison did not; Hassani neither.')).toBe('[P1] said; Alison did not; Hassani neither.');
  });

  it('a label it never gave out maps to nobody, and stays as written on the way back', () => {
    const t = new NameTable([member('u1', 'Huda Al-Harbi')], []);
    t.replace('Huda');
    expect(t.person('P7')).toBeNull();
    expect(t.person('Huda')).toBeNull();
    expect(t.writeBack('[P7] and [P1]')).toBe('[P7] and Huda Al-Harbi');
  });
});

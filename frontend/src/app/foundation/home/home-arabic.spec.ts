import ar from '../../../assets/i18n/ar.json';

// ACC-279 — Ahmad's Arabic rule (6 Nov): singular address, and no gendered verb
// about a person. These are the lines this ticket fixed; each must keep its fix.
const get = (path: string): string => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ar) as string;

describe('ar.json — singular address, no gendered verb about a person (ACC-279)', () => {
  it('the stage meanings note addresses one reader', () => {
    expect(get('workflow.editor.meaningsNote')).toContain('يعود إليك.');
    expect(get('workflow.editor.meaningsNote')).not.toContain('إليكم');
  });

  it('no committee change request line puts a masculine verb before a person\'s name', () => {
    const keys = [
      'committee.changeRequest.banner.bodyUnderReview',
      'committee.changeRequest.banner.bodyDraft',
      'committee.changeRequest.page.requestedBy',
      'committee.changeRequest.page.returnedBy',
      'committee.changeRequest.page.approvedBy',
      'committee.changeRequest.page.withdrawnBy',
      'committee.changeRequest.page.rejectedTitle',
      'committee.changeRequest.page.withdrawnTitle',
    ];
    for (const key of keys) {
      expect(get(key)).withContext(key).not.toMatch(/(قدّمه|قدمه|بدأه|أعاده|اعتمده|سحبه|رفضه) \{\{name\}\}/);
      expect(get(key)).withContext(key).toContain('من {{name}}');
    }
  });

  it('the add-member date hint says nothing about the person\'s gender', () => {
    expect(get('committee.memberForm.joinedHint')).toBe('اليوم، ما لم يكن الانضمام قد تمّ قبل ذلك.');
  });

  it('Home\'s greeting has two forms only, before and after noon', () => {
    expect(get('home.greeting.morning')).toBe('صباح الخير، {{name}}');
    expect(get('home.greeting.afternoon')).toBe('مساء الخير، {{name}}');
    expect(get('home.greeting.evening')).toBe('مساء الخير، {{name}}');
  });
});

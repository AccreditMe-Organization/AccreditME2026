import {
  readPreferences,
  readUrlParams,
  urlParamsFor,
  writePreferences,
} from './data-list.persistence';

// ACC-78 — the rules about WHICH state lives WHERE, tested because getting
// them wrong is not a crash, it is a list that quietly shows the wrong rows.
describe('data-list persistence (ACC-78)', () => {
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* storage may be unavailable; the code under test tolerates it */
    }
  });

  describe('preferences (localStorage)', () => {
    it('round-trips a preference', () => {
      writePreferences('users', { sortBy: 'email', sortDir: 'desc', pageSize: 50 });

      expect(readPreferences('users')).toEqual({
        sortBy: 'email',
        sortDir: 'desc',
        pageSize: 50,
      });
    });

    it('keeps lists separate by key', () => {
      writePreferences('users', { sortBy: 'email' });
      writePreferences('roles', { sortBy: 'nameAr' });

      expect(readPreferences('users').sortBy).toBe('email');
      expect(readPreferences('roles').sortBy).toBe('nameAr');
    });

    it('returns empty preferences for a list never saved', () => {
      expect(readPreferences('never-seen')).toEqual({});
    });

    // A list that cannot remember a sort order must still render. localStorage
    // throws outright in private windows and where site data is blocked, so a
    // storage failure has to be "no preferences", never an error.
    it('survives storage being unavailable', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('blocked');
        },
      });

      expect(() => writePreferences('users', { sortBy: 'email' })).not.toThrow();
      expect(readPreferences('users')).toEqual({});

      if (original) Object.defineProperty(window, 'localStorage', original);
    });

    it('survives corrupted stored JSON', () => {
      localStorage.setItem('accreditme.list.users', '{not json');

      expect(readPreferences('users')).toEqual({});
    });
  });

  describe('url params', () => {
    // A record page holds several lists at once. Unnamespaced params would have
    // Tasks, Members and Sub-committees reading each other's state.
    it('namespaces every param by list key', () => {
      const params = urlParamsFor('tasks', { search: 'audit', page: 2 }, 'overdue');

      expect(Object.keys(params).every((k) => k.startsWith('tasks.'))).toBe(true);
      expect(params['tasks.q']).toBe('audit');
      expect(params['tasks.scope']).toBe('overdue');
    });

    // null REMOVES a param. Writing empties would leave `?q.search=&q.page=1`
    // behind after clearing a filter — a URL that looks filtered and is not.
    it('removes params rather than writing empty ones', () => {
      const params = urlParamsFor('users', { search: '   ', page: 1 }, null);

      expect(params['users.q']).toBeNull();
      expect(params['users.page']).toBeNull();
      expect(params['users.scope']).toBeNull();
    });

    it('omits page 1, since it is the default', () => {
      expect(urlParamsFor('users', { page: 1 }, null)['users.page']).toBeNull();
      expect(urlParamsFor('users', { page: 3 }, null)['users.page']).toBe('3');
    });

    it('reads its own params back', () => {
      const { query, scope } = readUrlParams('users', {
        'users.q': 'ahmad',
        'users.sort': 'email',
        'users.dir': 'desc',
        'users.page': '4',
        'users.scope': 'invited',
      });

      expect(query).toEqual({
        search: 'ahmad',
        sortBy: 'email',
        sortDir: 'desc',
        page: 4,
      });
      expect(scope).toBe('invited');
    });

    // URLs are editable by anyone. A bad value should fall back to the default
    // rather than reach the backend and earn a 400 — the whitelist is the real
    // gate, this just avoids sending obvious nonsense.
    it('ignores a nonsense sort direction', () => {
      expect(readUrlParams('users', { 'users.dir': 'sideways' }).query.sortDir).toBeUndefined();
    });

    // Jasmine, not Jest — no it.each here.
    for (const page of ['0', '-3', 'abc', '']) {
      it(`ignores a nonsense page value: "${page}"`, () => {
        expect(readUrlParams('users', { 'users.page': page }).query.page).toBeUndefined();
      });
    }

    it('reads another list params as absent', () => {
      const { query } = readUrlParams('users', { 'roles.q': 'quality' });

      expect(query.search).toBeUndefined();
    });
  });
});

/**
 * ACC-154 — for unit specs that mock `$queryRaw`: answers the role FOR SHARE
 * lock (role-active.ts) with every role it asks for, active unless named in
 * `inactive`. Any other raw query answers `[]`, as the specs' default did.
 *
 *   mockPrisma.$queryRaw.mockImplementation(answerRoleShareLock());
 */
export function answerRoleShareLock(inactive: ReadonlySet<string> = new Set()) {
  return async (query: unknown): Promise<unknown[]> => {
    const sql = query as { sql?: string; values?: unknown[] } | undefined;
    if (!sql?.sql?.includes('FROM "Role"') || !sql.sql.includes('FOR SHARE')) return [];
    // The values are the role ids, then the organisation.
    const ids = (sql.values ?? []).slice(0, -1) as string[];
    return ids.map((id) => ({ id, isActive: !inactive.has(id) }));
  };
}

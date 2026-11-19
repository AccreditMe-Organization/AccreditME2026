import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

/**
 * ACC-95 — every notice the server builds is stored in BOTH languages, and no
 * notice text counts with "(s)".
 *
 * A NOTICE IS FOUND BY ITS OWN LITERAL, NEVER BY THE FILE IT SITS IN: any
 * object literal anywhere under backend/src (specs aside) that has both a
 * `titleEn` and a `bodyEn` property. That is the shape every
 * `notificationService.create()` and `createInAppMany()` row takes, and nothing
 * else in the code has it (a stage task definition has `titleEn` but no
 * `bodyEn`). So a notice moved to another file is still checked, and a notice
 * in a file written tomorrow is checked the day it is written. Findings name the
 * notice by its `titleEn` text; the file is only where it was found.
 *
 * Each notice must:
 *   - have `titleAr` and `bodyAr` too;
 *   - contain no "(s)" in any of its four texts, including what they are built
 *     from in the same file: an identifier in a text is followed to its
 *     declaration (a summary variable, a `counted()` forms constant), up to
 *     five steps.
 *
 * NON-VACUITY: the scan reads more than 20 notices, its matcher catches a
 * planted example of each shape, and reverting a real notice turns it red.
 */

const SRC = join(__dirname, '..', '..');
const TEXT_KEYS = ['titleEn', 'titleAr', 'bodyEn', 'bodyAr'] as const;
const MAX_HOPS = 5;

interface Finding {
  notice: string;
  where: string;
  problem: string;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith('.ts') && !/\.(db-)?spec\.ts$/.test(name)) out.push(path);
  }
  return out;
}

function propertyName(p: ts.ObjectLiteralElementLike): string | null {
  if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) && ts.isIdentifier(p.name)) {
    return p.name.text;
  }
  return null;
}

/** Every string and template piece in `node`, following identifiers to their declarations in the file. */
function textsOf(node: ts.Node, declarations: Map<string, ts.Node[]>, hops: number, seen: Set<ts.Node>): string[] {
  if (seen.has(node)) return [];
  seen.add(node);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    if (ts.isIdentifier(n) && hops > 0) {
      for (const init of declarations.get(n.text) ?? []) out.push(...textsOf(init, declarations, hops - 1, seen));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

export function noticeFindings(fileName: string, source: string): { notices: string[]; findings: Finding[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.Node[]>();
  const objects: ts.ObjectLiteralExpression[] = [];
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      declarations.set(n.name.text, [...(declarations.get(n.name.text) ?? []), n.initializer]);
    }
    if (ts.isObjectLiteralExpression(n)) objects.push(n);
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const notices: string[] = [];
  const findings: Finding[] = [];
  for (const obj of objects) {
    const props = new Map(obj.properties.map((p) => [propertyName(p), p] as const));
    if (!props.has('titleEn') || !props.has('bodyEn')) continue;
    const titleEn = props.get('titleEn')!;
    const notice = (ts.isPropertyAssignment(titleEn) ? titleEn.initializer : titleEn).getText(sf);
    notices.push(notice);
    const where = `${fileName}:${sf.getLineAndCharacterOfPosition(obj.getStart(sf)).line + 1}`;
    for (const key of ['titleAr', 'bodyAr'] as const) {
      if (!props.has(key)) findings.push({ notice, where, problem: `no ${key}` });
    }
    for (const key of TEXT_KEYS) {
      const p = props.get(key);
      if (!p) continue;
      const texts = textsOf(ts.isPropertyAssignment(p) ? p.initializer : p, declarations, MAX_HOPS, new Set());
      if (texts.some((t) => t.includes('(s)'))) findings.push({ notice, where, problem: `"(s)" in ${key}` });
    }
  }
  return { notices, findings };
}

function scanTree(): { notices: string[]; findings: Finding[] } {
  const all = sourceFiles(SRC).map((path) => noticeFindings(relative(SRC, path), readFileSync(path, 'utf8')));
  return { notices: all.flatMap((r) => r.notices), findings: all.flatMap((r) => r.findings) };
}

describe('ACC-95 — every server-built notice is stored in both languages, and never counts with "(s)"', () => {
  it('reads a real number of notices (non-vacuity)', () => {
    expect(scanTree().notices.length).toBeGreaterThan(20);
  });

  it('every notice has titleAr and bodyAr, and no "(s)" in its texts', () => {
    expect(scanTree().findings).toEqual([]);
  });

  describe('the matcher catches each shape (planted)', () => {
    const one = (body: string): string[] => noticeFindings('planted.ts', body).findings.map((f) => `${f.notice} | ${f.problem}`);

    it('a notice with no titleAr', () => {
      expect(one(`x.create({ userId, titleEn: 'A', bodyEn: 'b', bodyAr: 'ب' });`)).toEqual([`'A' | no titleAr`]);
    });

    it('a notice with no bodyAr, as a createInAppMany row', () => {
      expect(one(`const rows = ids.map((userId) => ({ userId, titleEn: 'A', titleAr: 'أ', bodyEn: 'b' }));`)).toEqual([`'A' | no bodyAr`]);
    });

    it('"(s)" written in a text', () => {
      expect(one("x.create({ titleEn: 'A', titleAr: 'أ', bodyEn: `${n} task(s) moved`, bodyAr: 'ب' });")).toEqual([`'A' | "(s)" in bodyEn`]);
    });

    it('"(s)" built in a variable the text uses', () => {
      expect(one("const summary = `${n} task(s) reassigned.`;\nx.create({ titleEn: 'A', titleAr: 'أ', bodyEn: `Done. ${summary}`, bodyAr: 'ب' });")).toEqual([
        `'A' | "(s)" in bodyEn`,
      ]);
    });

    it('a complete notice, and an object that is not a notice, pass', () => {
      expect(one(`x.create({ titleEn: 'A', titleAr: 'أ', bodyEn: 'b', bodyAr: 'ب' }); const def = { titleEn: 'T', titleAr: null };`)).toEqual([]);
    });
  });

  describe('reverting a checked notice turns the scan red (selftest on the real sources)', () => {
    const real = (path: string): string => readFileSync(join(SRC, path), 'utf8');

    it('dropping the Arabic title of "New task assigned"', () => {
      const path = 'foundation/task/task.service.ts';
      const source = real(path);
      // Two notices carry it (create, and the engine attaching assignees); the
      // first is create's.
      const property = "titleAr: 'مهمة جديدة مُسندة إليك',";
      expect(source.split(property).length - 1).toBe(2);
      const reverted = source.replace(property, '');
      expect(noticeFindings(path, source).findings).toEqual([]);
      expect(noticeFindings(path, reverted).findings.map((f) => `${f.notice} | ${f.problem}`)).toEqual([`'New task assigned' | no titleAr`]);
    });

    it('putting "(s)" back into the departure summary, two steps from the notice', () => {
      const path = 'foundation/user/user.service.ts';
      const source = real(path);
      const form = "one: '{count} task reassigned.'";
      expect(source.split(form).length - 1).toBe(1);
      const reverted = source.replace(form, "one: '{count} task(s) reassigned.'");
      expect(noticeFindings(path, source).findings).toEqual([]);
      expect(noticeFindings(path, reverted).findings.map((f) => `${f.notice} | ${f.problem}`)).toEqual([
        // The forms constant feeds both bodies, so both are red.
        '`${departedUser.name} has been deactivated` | "(s)" in bodyEn',
        '`${departedUser.name} has been deactivated` | "(s)" in bodyAr',
      ]);
    });
  });
});

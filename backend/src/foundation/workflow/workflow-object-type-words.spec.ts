import { readFileSync } from 'fs';
import { join } from 'path';
import { WorkflowObjectType } from '../../../generated/prisma/enums';
import { WORKFLOW_OBJECT_TYPE_WORDS } from './workflow-object-type-words';

// ACC-95 — the server's record-type words are the screens' words. The
// frontend's translation files are read at TEST time only; nothing at run time
// reads a frontend file.

const REPO = join(__dirname, '..', '..', '..', '..');
const screenWords = (lang: 'en' | 'ar'): Record<string, string> =>
  (JSON.parse(readFileSync(join(REPO, 'frontend', 'src', 'assets', 'i18n', `${lang}.json`), 'utf8')) as {
    workflow: { objectTypeName: Record<string, string> };
  }).workflow.objectTypeName;

describe('WORKFLOW_OBJECT_TYPE_WORDS — ACC-95', () => {
  it('names every WorkflowObjectType, and nothing else', () => {
    expect(Object.keys(WORKFLOW_OBJECT_TYPE_WORDS).sort()).toEqual(Object.values(WorkflowObjectType).sort());
  });

  it.each(['en', 'ar'] as const)("equals the screens' workflow.objectTypeName.* in %s, type by type", (lang) => {
    const screens = screenWords(lang);
    const server = Object.fromEntries(Object.entries(WORKFLOW_OBJECT_TYPE_WORDS).map(([type, words]) => [type, words[lang]]));
    expect(server).toEqual(screens);
  });
});

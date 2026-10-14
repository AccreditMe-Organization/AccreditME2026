import { PrismaService } from '../../prisma/prisma.service';
import { DraftLanguage, IDraftRecordContext } from './draft-answer';

/**
 * ACC-197 (Q2) — what each kind of record contributes to a task draft: its
 * type, its name, and for a committee its Purpose. Never a person's name.
 *
 * One entry per record type, like ObjectVisibilityService's rules. A type with
 * no entry contributes nothing, and the draft is made from the note alone.
 *
 * The CALLER has already checked that the viewer may see the record
 * (ObjectVisibilityService.assertCanView); every read here is still scoped by
 * id AND organizationId together.
 */
type Loader = (prisma: PrismaService, id: string, organizationId: string, language: DraftLanguage) => Promise<IDraftRecordContext | null>;

const LOADERS: Readonly<Record<string, Loader>> = {
  COMMITTEE: async (prisma, id, organizationId, language) => {
    const committee = await prisma.committee.findFirst({
      where: { id, organizationId },
      select: { nameEn: true, nameAr: true, purpose: true },
    });
    if (!committee) return null;
    // Arabic is never mandatory (ACC-160): no Arabic name → the English one.
    const name = language === 'ar' && committee.nameAr ? committee.nameAr : committee.nameEn;
    return { typeLabel: 'Committee', name, purpose: committee.purpose };
  },
  MEETING: async (prisma, id, organizationId) => {
    const meeting = await prisma.meeting.findFirst({ where: { id, organizationId }, select: { title: true } });
    return meeting ? { typeLabel: 'Meeting', name: meeting.title } : null;
  },
};

export function draftRecordContext(
  prisma: PrismaService,
  sourceType: string,
  sourceId: string,
  organizationId: string,
  language: DraftLanguage,
): Promise<IDraftRecordContext | null> {
  const loader = LOADERS[sourceType];
  return loader ? loader(prisma, sourceId, organizationId, language) : Promise.resolve(null);
}

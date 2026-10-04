import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { trimToNull } from './trim-to-null.transform';
import { CreateRoleDto } from '../../foundation/roles/dto/create-role.dto';
import { UpdateRoleDto } from '../../foundation/roles/dto/update-role.dto';
import { CreateCommitteeDto } from '../../foundation/committees/dto/create-committee.dto';
import { UpdateCommitteeDto } from '../../foundation/committees/dto/update-committee.dto';
import { CreateLookupValueDto } from '../../foundation/lookup/dto/create-lookup-value.dto';
import { UpdateLookupValueDto } from '../../foundation/lookup/dto/update-lookup-value.dto';
import { OverrideLabelDto } from '../../foundation/lookup/dto/override-label.dto';
import { CreateWorkflowTemplateDto } from '../../foundation/workflow/dto/create-workflow-template.dto';
import { UpdateWorkflowTemplateDto } from '../../foundation/workflow/dto/update-workflow-template.dto';
import { CreateWorkflowStageDto } from '../../foundation/workflow/dto/create-workflow-stage.dto';
import { UpdateWorkflowStageDto } from '../../foundation/workflow/dto/update-workflow-stage.dto';
import { CreateWorkflowTransitionDto } from '../../foundation/workflow/dto/create-workflow-transition.dto';
import { UpdateWorkflowTransitionDto } from '../../foundation/workflow/dto/update-workflow-transition.dto';
import { UpdateTenantDto } from '../../foundation/tenant/dto/update-tenant.dto';
import { CreatePlanDto } from '../../platform/plan/dto/create-plan.dto';

// ACC-160 — the optional-bilingual-name storage rule, and every DTO that must
// carry it.
//
// The table below is a NAMED list, deliberately, not a discovering predicate:
// a predicate over every `*Ar` DTO property would also flag CreateOrgUnitDto,
// the public-holiday DTOs, CreateOrgPositionDto and CreateAiCreditPackDto, which
// store '' rather than NULL today. Those are real, out of ACC-160's scope, and
// recorded as its follow-up — and ACC-120's rule is that a scan whose first act
// is to allowlist existing instances is a disabled scan. So this pins the eight
// DTOs this ticket owns, by name, and the follow-up is where a predicate
// belongs once those four are fixed.

type DtoClass = new () => object;

// Same options as main.ts's global ValidationPipe.
const parse = (cls: DtoClass, body: object): Record<string, unknown> =>
  plainToInstance(cls, body, { enableImplicitConversion: false }) as Record<string, unknown>;

const errorsOn = (cls: DtoClass, body: object, field: string): string[] =>
  validateSync(parse(cls, body), { whitelist: true, forbidNonWhitelisted: true })
    .filter((e) => e.property === field)
    .flatMap((e) => Object.keys(e.constraints ?? {}));

describe('trimToNull (ACC-160)', () => {
  const run = (value: unknown): unknown => trimToNull({ value } as never);

  it('trims a real value', () => expect(run('  قائد  ')).toBe('قائد'));
  it("turns '' into null", () => expect(run('')).toBeNull());
  it('turns whitespace-only into null', () => expect(run(' \t\n ')).toBeNull());
  it('passes null through', () => expect(run(null)).toBeNull());
  it('passes undefined through, so an omitted field stays omitted', () =>
    expect(run(undefined)).toBeUndefined());
  // Not its job to coerce: @IsString() refuses this by name.
  it('passes a non-string through untouched', () => expect(run(42)).toBe(42));
});

describe('every DTO that carries the optional-Arabic-name rule (ACC-160)', () => {
  // ── THE NON-VACUITY GUARD, first. ─────────────────────────────────────────
  // Every row below asserts "'' is accepted and becomes NULL". That would also
  // pass if the pipeline validated nothing at all. Plan.nameAr is platform data,
  // explicitly out of scope, and still required: if '' were accepted there, the
  // table would be proving nothing.
  it('leaves the out-of-scope Plan.nameAr required, so the table below means something', () => {
    expect(errorsOn(CreatePlanDto, { nameAr: '' }, 'nameAr')).toContain('isNotEmpty');
  });

  const rows: [string, DtoClass, string][] = [
    ['CreateRoleDto', CreateRoleDto, 'nameAr'],
    ['UpdateRoleDto', UpdateRoleDto, 'nameAr'],
    ['CreateCommitteeDto', CreateCommitteeDto, 'nameAr'],
    ['UpdateCommitteeDto', UpdateCommitteeDto, 'nameAr'],
    ['CreateLookupValueDto', CreateLookupValueDto, 'labelAr'],
    ['UpdateLookupValueDto', UpdateLookupValueDto, 'labelAr'],
    ['OverrideLabelDto', OverrideLabelDto, 'labelOverrideAr'],
    ['CreateWorkflowTemplateDto', CreateWorkflowTemplateDto, 'nameAr'],
    ['UpdateWorkflowTemplateDto', UpdateWorkflowTemplateDto, 'nameAr'],
    ['CreateWorkflowStageDto', CreateWorkflowStageDto, 'nameAr'],
    ['UpdateWorkflowStageDto', UpdateWorkflowStageDto, 'nameAr'],
    ['CreateWorkflowTransitionDto', CreateWorkflowTransitionDto, 'labelAr'],
    ['UpdateWorkflowTransitionDto', UpdateWorkflowTransitionDto, 'labelAr'],
    ['UpdateTenantDto', UpdateTenantDto, 'nameAr'],
  ];

  // Only the Arabic field's own errors are read: a create DTO's OTHER required
  // fields are absent from these bodies and their errors are not the subject.
  describe.each(rows)('%s.%s', (_name, cls, field) => {
    it("accepts '' and stores NULL, never ''", () => {
      expect(parse(cls, { [field]: '' })[field]).toBeNull();
      expect(errorsOn(cls, { [field]: '' }, field)).toEqual([]);
    });

    it('accepts an explicit null', () => {
      expect(errorsOn(cls, { [field]: null }, field)).toEqual([]);
    });

    it('trims a real value', () => {
      expect(parse(cls, { [field]: '  اسم  ' })[field]).toBe('اسم');
    });

    it('stays undefined when omitted, so an unrelated update cannot clear it', () => {
      expect(parse(cls, {})[field]).toBeUndefined();
      expect(errorsOn(cls, {}, field)).toEqual([]);
    });

    it('still refuses a value longer than its column', () => {
      expect(errorsOn(cls, { [field]: 'ا'.repeat(256) }, field)).toContain('maxLength');
    });

    it('still refuses a non-string', () => {
      expect(errorsOn(cls, { [field]: 42 }, field)).toContain('isString');
    });
  });
});

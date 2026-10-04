import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ITenant, TenantService } from '../../../tenant/services/tenant.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { FieldComponent } from '../../../../shared/components/field/field.component';

@Component({
  selector: 'app-organization-profile',
  standalone: true,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    MessageModule,
    // ACC-111's required field wrapper — it owns the label, the error text
    // and aria-invalid, and a form-bound field without [control] can never
    // show an error (check:field-control).
    FieldComponent,
  ],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <app-page-header [title]="'adminSettings.organizationProfile' | translate" />

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <!-- ACC-123 — the route is gated on tenant:view (ADMIN_SETTINGS_ROUTES),
           but SAVING is PATCH /tenant, which enforces TENANT_PERMISSIONS.UPDATE
           (tenant.controller.ts). Those are not the same permission, and before
           this the whole form rendered editable with a live Save to anyone who
           could open the page — found by standing on it as READ_ONLY_ADMIN.

           Disabled inputs plus a sentence, the same shape working-calendar
           already uses for its own org:manage split. -->
      @if (!canEdit()) {
        <p class="text-sm text-[var(--am-text-secondary)]">
          {{ 'adminSettings.profileReadOnly' | translate }}
        </p>
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <!-- ACC-120 — THE NAME PAIR, to the reviewed drawing. Two siblings:
             the Arabic name is not a condition on the English one, and is not
             required, because Arabic fields are never mandatory in this
             product. country is gone: it is absent from the drawing, and
             sending it is what made every save on this screen fail. -->
        <div class="grid gap-4 md:grid-cols-2">
          <am-field
            [label]="'adminSettings.orgNameEn' | translate"
            inputId="name"
            [control]="form.controls.name"
            [errorMessages]="{ required: 'adminSettings.orgNameEnRequired' | translate }"
          >
            <input pInputText id="name" formControlName="name" class="w-full" />
          </am-field>

          <am-field
            [label]="'adminSettings.orgNameAr' | translate"
            inputId="nameAr"
            [control]="form.controls.nameAr"
            [hint]="'adminSettings.orgNameArHint' | translate"
            [errorMessages]="{ maxlength: 'adminSettings.orgNameArTooLong' | translate }"
          >
            <input
              pInputText
              id="nameAr"
              formControlName="nameAr"
              dir="rtl"
              maxlength="255"
              class="w-full"
            />
          </am-field>
        </div>

        <!-- ACC-120 — THE LOGO SECTION REPLACES THE "S3 key" TEXT BOX, which
             asked a hospital administrator to type a storage path.
             No dropzone: there is no upload endpoint, no bucket and no signed
             URL anywhere in the product, so an upload control would be an
             action whose result is fake. What is shown instead is what is
             actually true today — the monogram, at the three sizes a logo
             would appear at, and a note saying upload is not live. -->
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium">{{ 'adminSettings.logo' | translate }}</span>

          <div
            class="flex items-start gap-2 rounded border border-dashed border-[var(--am-text-secondary)] p-3"
          >
            <span
              class="shrink-0 rounded border border-[var(--am-text-secondary)] bg-[var(--am-surface)] px-[6px] text-[11px] font-bold"
              >{{ 'common.notActiveYet' | translate }}</span
            >
            <span class="text-sm">{{ 'adminSettings.logoNotActiveYet' | translate }}</span>
          </div>

          <div class="flex flex-wrap items-end gap-4 pt-1">
            @for (size of logoSizes; track size.px) {
              <div class="flex flex-col items-center gap-1">
                <span
                  class="flex items-center justify-center rounded-md border border-[var(--am-border)] bg-[var(--am-surface)] font-bold text-[var(--am-blue-primary)]"
                  [style.width.px]="size.px"
                  [style.height.px]="size.px"
                  [style.fontSize.px]="size.px / 2.6"
                  >{{ monogram() }}</span
                >
                <span class="text-[11px] text-[var(--am-text-secondary)]">
                  {{ size.key | translate }}
                </span>
              </div>
            }
          </div>
        </div>
        @if (canEdit()) {
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
          </div>
        }
      </form>
    </div>
  `,
})
export class OrganizationProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);
  private readonly navigationAccess = inject(NavigationAccessService);

  readonly canEdit = computed(() => this.navigationAccess.hasPermission('tenant:update'));

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  /** The loaded tenant, for the monogram the logo section previews. */
  readonly tenant = signal<ITenant | null>(null);

  /**
   * ACC-120 — the monogram shown wherever a logo would appear.
   *
   * Initials from the English name: the first letter of the first two words, so
   * "King Fahad Medical City" gives KF, matching the drawing. Falls back to one
   * letter, then to a dash, because a tenant name is never empty in practice
   * but a blank square is a worse answer than a placeholder if it ever is.
   */
  readonly monogram = computed(() => {
    const name = (this.tenant()?.name ?? '').trim();
    if (!name) return '—';
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((word: string) => word[0] ?? '')
      .join('');
    return initials.toUpperCase() || '—';
  });

  /**
   * Where the logo appears, at the sizes it appears — the drawing's own three,
   * each labelled with its place so the preview explains itself.
   */
  readonly logoSizes = [
    { px: 34, key: 'adminSettings.logoWhereSignIn' },
    { px: 28, key: 'adminSettings.logoWhereSidebar' },
    { px: 20, key: 'adminSettings.logoWhereReport' },
  ] as const;

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    // ACC-120 — OPTIONAL, and that is a product rule rather than this screen's
    // choice: Arabic fields are never mandatory, because the product is sold to
    // customers who do not operate in Arabic. It is why Organization.nameAr,
    // OrgUnit.nameAr, OrgPosition.nameAr, PublicHoliday.nameAr and
    // AiCreditPack.nameAr are all nullable.
    //
    // So there is no Validators.required here, and no stronger promise at any
    // other layer either — the column is nullable, the DTO is optional, and an
    // empty value stores NULL rather than ''. A sibling of the English name,
    // not a condition on it.
    nameAr: ['', [Validators.maxLength(255)]],
  });

  ngOnInit(): void {
    // Disabling the CONTROLS rather than only hiding Save: a form that accepts
    // typing and then has nowhere to send it is the defect in a quieter form.
    if (!this.canEdit()) this.form.disable();

    this.tenantService.getCurrent().subscribe({
      next: (tenant) => {
        this.tenant.set(tenant);
        // '' rather than null: a reactive control holding null renders as empty
        // anyway, but the two differ on submit, and the empty-to-null decision
        // belongs in one place — the DTO — not in two.
        this.form.patchValue({ name: tenant.name, nameAr: tenant.nameAr ?? '' });
      },
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onSubmit(): void {
    // FIRST, before any state is set: a disabled control is excluded from
    // validation, so form.invalid is false on a read-only form and would not
    // stop anything. Setting saving() before this check left the spinner on.
    if (!this.canEdit()) return;
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.form.getRawValue();
    this.tenantService
      // `country` is not sent. It never belonged here — UpdateTenantDto has no
      // such property and the strict pipe refused the whole request, so every
      // save failed. `logo` is not sent either: the S3-key box it came from is
      // gone (see the template).
      .update({ name: value.name!, nameAr: value.nameAr ?? '' })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.savedMessage.set('adminSettings.savedSuccess');
        },
        error: () => {
          this.saving.set(false);
          this.error.set('adminSettings.errorSave');
        },
      });
  }
}

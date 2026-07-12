---
name: angular-component
description: Angular component structure and styling rules for AccreditMe. Invoke manually with /angular-component when creating any new Angular component, page, or service.
disable-model-invocation: true
allowed-tools: Read Glob Grep Write Edit Bash(npx tsc --noEmit) Bash(git add frontend/src/*) Bash(git add frontend/src/assets/*) Bash(git commit *) Bash(git status *)
---

# AccreditMe — Angular Component Scaffold Rules

Read this skill completely before creating any new Angular component, page, or service.
Every frontend file in AccreditMe follows these conventions without exception.
Consistency makes the codebase navigable, RTL-safe, and brand-consistent.

---

## Component Location Reference

```
frontend/src/app/
├── core/                         # Singleton services — provided once app-wide
│   ├── services/                 # AuthService, TenantService, UserService
│   ├── guards/                   # AuthGuard, PermissionGuard
│   └── interceptors/             # AuthInterceptor (attaches JWT to all requests)
│
├── shared/                       # Reusable across all modules
│   ├── components/               # StatusPill, ConfirmDialog, EmptyState, etc.
│   ├── directives/               # PermissionDirective, RtlDirective
│   └── pipes/                    # TranslateLookupPipe, DateFormatPipe, TruncatePipe
│
├── layout/                       # App shell — rendered once, wraps everything
│   ├── topbar/                   # Logo, search, notifications, user avatar
│   ├── sidebar/                  # Module navigation, collapse support
│   └── layout.component.ts       # Grid shell: topbar + sidebar + router-outlet
│
├── foundation/                   # Foundation module UIs
│   ├── tenant/                   # Tenant settings and provider config
│   ├── org/                      # Org unit hierarchy, org chart
│   ├── calendar/                 # Working calendar, holidays, working hours
│   ├── lookup/                   # Lookup category and value management
│   ├── roles/                    # Role and permission management
│   ├── workflow-config/          # Workflow template and stage configuration
│   ├── notifications/            # Notification rules and preferences
│   ├── tasks/                    # My tasks inbox, task detail
│   ├── users/                    # User management, invite, assign roles
│   ├── committees/               # Committee management, membership
│   └── meetings/                 # Meeting lifecycle, agenda, minutes
│
├── modules/                      # Functional module UIs
│   ├── standards/                # Standards hierarchy, measurable elements
│   ├── documents/                # Document lifecycle, review, approval
│   ├── quality-improvement/      # Incidents, gaps, corrective actions
│   └── audit/                    # Audit plans, execution, findings, reports
│
├── platform/                     # Super admin portal (platform admins only)
│   ├── tenants/                  # Tenant list, detail, suspend, impersonate
│   ├── billing/                  # Revenue, plan distribution, churn
│   └── health/                   # System health, job queues, error rates
│
└── dashboard/                    # Main dashboard — AI morning briefing + KPIs
```

---

## Required File Structure Per Feature Area

Every feature area follows this exact structure:

```
{feature}/
├── {feature}.routes.ts
├── {feature}.service.ts
├── {feature}-list/
│   ├── {feature}-list.component.ts
│   └── {feature}-list.component.html
├── {feature}-detail/
│   ├── {feature}-detail.component.ts
│   └── {feature}-detail.component.html
├── {feature}-form/
│   ├── {feature}-form.component.ts
│   └── {feature}-form.component.html
└── interfaces/
    └── {feature}.interface.ts
```

---

## Component TypeScript Template

```typescript
// {feature}-list.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
// Import ONLY the PrimeNG modules this component actually uses

import { {Feature}Service } from '../{feature}.service';
import { I{Feature} } from '../interfaces/{feature}.interface';

@Component({
  selector: 'app-{feature}-list',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    TableModule,
    ButtonModule,
    ProgressSpinnerModule,
    // Only what this component uses — never import entire PrimeNG
  ],
  templateUrl: './{feature}-list.component.html',
})
export class {Feature}ListComponent implements OnInit {
  private readonly {feature}Service = inject({Feature}Service);

  // Always use Signals for state — never direct property mutation
  items = signal<I{Feature}[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  selectedItem = signal<I{Feature} | null>(null);

  ngOnInit(): void {
    this.loadItems();
  }

  private loadItems(): void {
    this.loading.set(true);
    this.error.set(null);

    this.{feature}Service.findAll().subscribe({
      next: (data) => {
        this.items.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('errors.loadFailed');
        this.loading.set(false);
      },
    });
  }
}
```

---

## Component Template Rules

```html
<!-- {feature}-list.component.html -->

<!-- Page wrapper — always these Tailwind classes, never custom CSS -->
<div class="flex flex-col gap-4 p-6 h-full">
  <!-- Page header — breadcrumb + title + primary action -->
  <div class="flex items-center justify-between">
    <div>
      <p-breadcrumb [model]="breadcrumbItems" />
      <h1 class="text-xl font-medium text-slate-700 mt-1">
        {{ '{feature}.pageTitle' | translate }}
      </h1>
    </div>
    <p-button
      [label]="'{feature}.actions.create' | translate"
      icon="ti ti-plus"
      (onClick)="openCreateDialog()"
    />
  </div>

  <!-- Loading state — always show spinner during API calls -->
  <div *ngIf="loading()" class="flex items-center justify-center h-full">
    <p-progressSpinner />
  </div>

  <!-- Error state — never silent failures -->
  <div
    *ngIf="error() && !loading()"
    class="flex items-center justify-center h-full"
  >
    <p-message severity="error" [text]="error()! | translate" />
  </div>

  <!-- Data table — always scrollable, always fills remaining space -->
  <p-table
    *ngIf="!loading() && !error()"
    [value]="items()"
    scrollable
    scrollHeight="flex"
    styleClass="p-datatable-sm"
    [rowHover]="true"
  >
    <ng-template pTemplate="header">
      <tr>
        <th>{{ '{feature}.columns.name' | translate }}</th>
        <th>{{ '{feature}.columns.status' | translate }}</th>
        <th class="w-24">{{ 'common.columns.actions' | translate }}</th>
      </tr>
    </ng-template>

    <ng-template pTemplate="body" let-item>
      <tr>
        <td>{{ item.name }}</td>
        <td>
          <!-- Status pill — use semantic CSS class, never hardcode colors -->
          <span class="status-pill status-{{ item.status }}">
            {{ 'status.' + item.status | translate }}
          </span>
        </td>
        <td>
          <div class="flex gap-1">
            <p-button
              icon="ti ti-eye"
              [text]="true"
              [rounded]="true"
              size="small"
              (onClick)="view(item)"
            />
            <p-button
              icon="ti ti-edit"
              [text]="true"
              [rounded]="true"
              size="small"
              (onClick)="edit(item)"
            />
          </div>
        </td>
      </tr>
    </ng-template>

    <!-- Empty state -->
    <ng-template pTemplate="emptymessage">
      <tr>
        <td colspan="3" class="text-center py-12 text-slate-400">
          {{ '{feature}.messages.empty' | translate }}
        </td>
      </tr>
    </ng-template>
  </p-table>
</div>
```

---

## API Service Template

```typescript
// {feature}.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { I{Feature} } from './interfaces/{feature}.interface';
import { Create{Feature}Dto } from './interfaces/{feature}-create.dto';

@Injectable({ providedIn: 'root' })
export class {Feature}Service {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/v1/{feature}`;

  findAll(): Observable<I{Feature}[]> {
    return this.http.get<I{Feature}[]>(this.baseUrl);
  }

  findOne(id: string): Observable<I{Feature}> {
    return this.http.get<I{Feature}>(`${this.baseUrl}/${id}`);
  }

  create(dto: Create{Feature}Dto): Observable<I{Feature}> {
    return this.http.post<I{Feature}>(this.baseUrl, dto);
  }

  update(id: string, dto: Partial<Create{Feature}Dto>): Observable<I{Feature}> {
    return this.http.patch<I{Feature}>(`${this.baseUrl}/${id}`, dto);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
```

---

## Interface Template

```typescript
// interfaces/{feature}.interface.ts
export interface I{Feature} {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Reactive Form Template

All forms use Angular Reactive Forms — never template-driven forms.

```typescript
// {feature}-form.component.ts
import { Component, inject, input, output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-{feature}-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    InputTextModule,
    TextareaModule,
    ButtonModule,
  ],
  templateUrl: './{feature}-form.component.html',
})
export class {Feature}FormComponent {
  // Use input() signals for inputs — not @Input() decorator
  initialData = input<Partial<I{Feature}> | null>(null);

  // Use output() signals — not @Output() EventEmitter
  saved = output<void>();
  cancelled = output<void>();

  private readonly fb = inject(FormBuilder);
  saving = signal(false);

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(2000)]],
    // Add fields specific to this feature
    // NEVER include organizationId — set by backend from JWT
  });

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    // call service — set saving back to false in subscription
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }
}
```

```html
<!-- {feature}-form.component.html -->
<form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
  <!-- Name field -->
  <div class="flex flex-col gap-1">
    <label for="name" class="text-sm font-medium text-slate-700">
      {{ '{feature}.labels.name' | translate }}
      <span class="text-red-500">*</span>
    </label>
    <input
      pInputText
      id="name"
      formControlName="name"
      [placeholder]="'{feature}.placeholders.name' | translate"
      [ngClass]="{ 'ng-invalid ng-dirty': isInvalid('name') }"
    />
    <small class="text-red-500" *ngIf="isInvalid('name')">
      {{ 'validation.required' | translate }}
    </small>
  </div>

  <!-- Description field -->
  <div class="flex flex-col gap-1">
    <label for="description" class="text-sm font-medium text-slate-700">
      {{ '{feature}.labels.description' | translate }}
    </label>
    <textarea
      pTextarea
      id="description"
      formControlName="description"
      [placeholder]="'{feature}.placeholders.description' | translate"
      rows="4"
    ></textarea>
  </div>

  <!-- Form actions -->
  <div class="flex justify-end gap-2 pt-2">
    <p-button
      [label]="'common.actions.cancel' | translate"
      severity="secondary"
      [text]="true"
      (onClick)="cancelled.emit()"
      [disabled]="saving()"
    />
    <p-button
      [label]="'common.actions.save' | translate"
      type="submit"
      [loading]="saving()"
    />
  </div>
</form>
```

---

## Styling Rules — Non-Negotiable

### Use Design Tokens — Never Hardcode Colors

```html
<!-- WRONG — hardcoded color -->
<div style="background-color: #2E6FA3">
  <div class="bg-blue-600">
    <!-- RIGHT — design token -->
    <div class="bg-[var(--am-blue-primary)]"></div>
  </div>
</div>
```

### Use Tailwind for Layout — Never Bootstrap or Inline Styles

```html
<!-- WRONG -->
<div class="row">
  <div class="col-md-8">
    <div style="display: flex; gap: 16px">
      <!-- RIGHT -->
      <div class="grid grid-cols-3 gap-4">
        <div class="col-span-2">
          <div class="flex gap-4"></div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### RTL Safety — Always Use Logical Properties

```html
<!-- WRONG — does not flip in Arabic RTL mode -->
<div class="pl-4 pr-2 text-left ml-auto">
  <!-- RIGHT — flips automatically in RTL -->
  <div class="ps-4 pe-2 text-start ms-auto"></div>
</div>
```

### PrimeNG Tables — Always Scrollable

```html
<!-- WRONG — page scrolls instead of table -->
<p-table [value]="items()">
  <!-- RIGHT — table fills viewport, page never scrolls -->
  <p-table [value]="items()" scrollable scrollHeight="flex"></p-table
></p-table>
```

---

## Translation Rules

Every visible string goes through ngx-translate.
Never hardcode English or Arabic text in templates.

### Translation Key Convention

```
{feature}.pageTitle
{feature}.columns.{columnName}
{feature}.actions.{actionName}
{feature}.labels.{labelName}
{feature}.placeholders.{fieldName}
{feature}.messages.empty
{feature}.messages.createSuccess
{feature}.messages.updateSuccess
{feature}.messages.deleteConfirm
common.actions.save
common.actions.cancel
common.actions.delete
common.actions.edit
common.columns.actions
status.draft
status.active
status.inactive
validation.required
validation.maxLength
errors.loadFailed
```

### Add to BOTH files before committing

```
frontend/src/assets/i18n/en.json
frontend/src/assets/i18n/ar.json
```

Arabic translations must be actual Arabic text — not placeholders.
If Arabic translation is unknown — mark it clearly with a TODO comment
and add the English text temporarily so the app does not break.

---

## Routes Template

```typescript
// {feature}.routes.ts
import { Routes } from '@angular/router';

export const {FEATURE}_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./{feature}-list/{feature}-list.component')
        .then(m => m.{Feature}ListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./{feature}-detail/{feature}-detail.component')
        .then(m => m.{Feature}DetailComponent),
  },
];
```

Register in parent routing file as lazy-loaded route:

```typescript
{
  path: '{feature}',
  loadChildren: () =>
    import('./path/to/{feature}/{feature}.routes')
      .then(m => m.{FEATURE}_ROUTES),
  canActivate: [AuthGuard],
}
```

---

## TypeScript Verification

Run after completing all component files:

```bash
cd frontend && npx tsc --noEmit
```

Must produce zero errors before committing.

---

## Final Checklist Before Committing Any Component

- [ ] Component is standalone — no NgModule
- [ ] Only imports PrimeNG modules it actually uses
- [ ] State managed with Signals — no direct property mutation
- [ ] No hardcoded colors — design tokens only
- [ ] No Bootstrap classes — Tailwind only for layout
- [ ] No inline styles — Tailwind or tokens only
- [ ] RTL tested — logical properties used (ps-, pe-, ms-, me-)
- [ ] All visible strings use translate pipe — no hardcoded text
- [ ] Translation keys added to BOTH en.json AND ar.json
- [ ] Forms use Reactive Forms — not template-driven
- [ ] Loading state shown during API calls
- [ ] Error state handled — no silent failures
- [ ] Empty state shown when no data
- [ ] Table uses scrollable + scrollHeight="flex"
- [ ] API calls go through service — never directly in component
- [ ] TypeScript errors: zero — npx tsc --noEmit
- [ ] Routes registered in parent routing file

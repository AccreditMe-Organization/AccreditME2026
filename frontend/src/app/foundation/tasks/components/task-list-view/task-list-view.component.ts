import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { AmDatePipe, AmNumberPipe, FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { SortHeaderComponent, SortState, nextSort } from '../../../../shared/components/sort-header/sort-header.component';
import { TaskLinkComponent } from '../task-link/task-link.component';
import { TaskActionFailure, TaskActionHostComponent } from '../task-action-host/task-action-host.component';
import {
  ITaskRecordListDto,
  ITaskRecordRowDto,
  TaskRecordListQuery,
  TaskRecordListSort,
  TaskRecordListStatus,
  TaskRecordListView,
  TaskService,
} from '../../services/task.service';
import { TaskRowActionId, TaskRowActionModel, asRowAction, taskRowActions } from '../../task-row-actions';
import { TaskRowText } from '../../task-row-text';
import { taskPoolLabel } from '../../task-pool-label';
import { taskPriorityGlyph, taskPriorityKey, taskRecordHref, taskRecordTypeKey } from '../../task-row-display';
import { isTaskOverdue } from '../../task-status';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

/** Below this window width rows are two-line cards (the phone sheet). */
export const TASK_LIST_PHONE_BELOW_PX = 760;
const PAGE = 50;
const SEARCH_DELAY_MS = 250;
/**
 * ACC-120 slice 3 — My tasks' list, under its two sections: the page's frame
 * (border, radius, surface) with no fixed height, so the page scrolls as one,
 * and its five tracks (Task · record, Priority, Due, Status, actions), each
 * fixed or fr under the ACC-234 rule. Utilities, so the component's styles
 * stay inside their budget; the row rule reads the two variables.
 */
const MINE_ROOT =
  'border border-[var(--am-border)] rounded-[var(--am-radius-card)] bg-[var(--am-surface-raised)] [--am-tl-cols:minmax(180px,3fr)_96px_minmax(130px,1.3fr)_minmax(110px,1fr)_150px] [--am-tl-min:720px]';

const STATUSES: TaskRecordListStatus[] = ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED', 'COMPLETED', 'CANCELLED'];
/**
 * ACC-234 — the columns the server sorts by, in column order, with their
 * header's label. Assignee and Created by have no server sort, and the
 * server's "created" sort orders by a date no column shows, so none of the
 * three is a header you can press.
 */
const SORTABLE: { key: TaskRecordListSort; labelKey: string }[] = [
  { key: 'title', labelKey: 'taskList.col.task' },
  { key: 'status', labelKey: 'taskList.col.status' },
  { key: 'due', labelKey: 'taskList.col.due' },
  { key: 'updated', labelKey: 'taskList.col.updated' },
];
/** The order the list opens in: overdue first, then soonest due, open before closed. */
const DEFAULT_SORT: SortState = { key: 'due', dir: 'asc' };

/**
 * ACC-120 slice 3 — the status chips of the viewer's own views (Task Screens:
 * "All open · 9", then one chip per status). Only the statuses a task in that
 * view can have: nobody is ever "on" an Unassigned or a Rejected task, so My
 * tasks leaves both out. "All open" is the default and is not a filter.
 */
type OwnView = 'mine' | 'created';
export type StatusChipId = 'OPEN' | TaskRecordListStatus;
const OPEN_STATUSES: Record<OwnView, TaskRecordListStatus[]> = {
  created: ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED'],
  mine: ['PENDING', 'IN_PROGRESS', 'ON_HOLD'],
};
const CHIP_STATUSES: Record<OwnView, TaskRecordListStatus[]> = {
  created: ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED', 'COMPLETED', 'CANCELLED'],
  mine: ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
};

interface Chip {
  id: 'q' | 'status' | 'overdue' | 'who' | 'required' | 'due' | 'mine' | 'link' | 'recordType' | 'unit';
  label: string;
}

interface ViewRow {
  row: ITaskRecordRowDto;
  title: string;
  due: { text: string; tone: string };
  /** The due text split at its " · ": the relative half, then the date. */
  dueParts: string[];
  who: string;
  position: string;
  statusKey: string;
  fact: string | null;
  /** Under the title: the record, then the fact, as one line (whole in its tooltip when cut). */
  subLine: string | null;
  tagKey: string | null;
  recordLine: string | null;
  /** ACC-120 slice 3 — the own views: the record's name (or its type word), and where it opens. */
  recordName: string | null;
  recordHref: string[] | null;
  /** Open, not on hold, its due time passed (isTaskOverdue). */
  overdue: boolean;
  /** ACC-120 slice 3 — My tasks' Priority column: text, never colour; a glyph on High and Critical. */
  priority: { glyph: string | null; label: string };
  model: TaskRowActionModel;
  menu: RowMenuItem[][];
}

/**
 * ACC-229 — THE ALL TASKS LIST (Record Tasks Panel §2): a record's tasks in
 * the popup behind "See all", or the organisation's at /tasks/all.
 *
 * Everything is the server's: search, filters and sort run there, 50 rows at a
 * time, so a list of hundreds stays quick and Load more continues the same
 * order. It opens on its defaults every time and remembers nothing (drawn Q3).
 *
 * Only the list scrolls. The toolbar, chips, column header and footer stay
 * put; below 760px the rows become two-line cards. A row's action runs in
 * place: the row is read again where it sits, and a failure is said under
 * that row only (ACC-217).
 */
@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe, AmDatePipe, AmNumberPipe, OverlaySelectComponent, RowMenuComponent, SortHeaderComponent, TaskLinkComponent, TaskActionHostComponent],
  template: `
    <div class="am-tl" [class]="rootClass()" data-testid="task-list-view">
      <!-- ACC-120 slice 3 — a view the server refused (403) offers nothing to search,
           filter or sort: only the denied state below. -->
      @if (phase() !== 'denied') {
        <div class="am-tl__toolbar" role="search" data-testid="task-list-toolbar">
          <span class="am-tl__search">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              #search
              type="search"
              [value]="qInput()"
              (input)="onSearch(search.value)"
              [attr.aria-label]="'taskList.searchLabel' | translate"
              [placeholder]="'taskList.searchPlaceholder' | translate"
              data-testid="task-list-search"
            />
          </span>
          @if (ownView()) {
            <!-- ACC-120 slice 3 — the own views' status chips: one pressed at a
                 time, "All open" by default. Each carries its count from the
                 first page's facets.statusCounts, over the view's whole scope;
                 with no facets, no count. -->
            <div class="order-first basis-full flex flex-nowrap gap-1.5 min-w-0 overflow-x-auto [scrollbar-width:thin]" role="group" [attr.aria-label]="'taskList.filter.status' | translate" data-testid="task-list-status-chips">
              @for (c of statusChips(); track c.id) {
                <button
                  type="button"
                  class="flex-none [font:inherit] text-[12px] h-7 px-2.5 whitespace-nowrap cursor-pointer border border-[var(--am-control-border)] rounded-[var(--am-radius-pill)] bg-[var(--am-surface-raised)] text-[var(--am-ink-900)] aria-pressed:border-[var(--am-primary-600)] aria-pressed:bg-[var(--am-primary-100)] aria-pressed:text-[var(--am-primary-700)] aria-pressed:font-semibold focus-visible:outline-[length:var(--am-focus-ring-width)] focus-visible:outline-[var(--am-focus-ring)]"
                  [attr.aria-pressed]="statusChip() === c.id"
                  [attr.data-chip]="c.id"
                  (click)="statusChip.set(c.id)"
                >
                  {{ c.label }}@if (c.count !== null) {<span> · {{ c.count | amNumber }}</span>}
                </button>
              }
            </div>
          } @else {
          <app-overlay-select
            class="am-tl__filter"
            [options]="statusOptions()"
            [placeholder]="'taskList.filter.status' | translate"
            [ariaLabel]="'taskList.filter.status' | translate"
            [showClear]="true"
            [ngModel]="status()"
            (ngModelChange)="status.set($event)"
            data-testid="filter-status"
          />
          }
          <button type="button" class="am-tl__toggle" [attr.aria-pressed]="overdue()" (click)="overdue.set(!overdue())" data-testid="filter-overdue">
            {{ 'taskList.filter.overdueOnly' | translate }}
          </button>
          @if (!isMine()) {
          <app-overlay-select
            class="am-tl__filter am-tl__filter--wide"
            [options]="whoOptions()"
            optionGroupLabel="label"
            optionGroupChildren="items"
            [groupsSelectable]="false"
            [placeholder]="'taskList.filter.assignee' | translate"
            [ariaLabel]="'taskList.filter.assignee' | translate"
            [showClear]="true"
            [ngModel]="who()"
            (ngModelChange)="who.set($event)"
            data-testid="filter-who"
          />
          }
          <app-overlay-select
            class="am-tl__filter"
            [options]="requiredOptions()"
            [placeholder]="'taskList.filter.required' | translate"
            [ariaLabel]="'taskList.filter.required' | translate"
            [showClear]="true"
            [ngModel]="required()"
            (ngModelChange)="required.set($event)"
            data-testid="filter-required"
          />
          <app-overlay-select
            class="am-tl__filter"
            [options]="dueOptions()"
            [placeholder]="'taskList.filter.due' | translate"
            [ariaLabel]="'taskList.filter.due' | translate"
            [showClear]="true"
            [ngModel]="due()"
            (ngModelChange)="due.set($event)"
            data-testid="filter-due"
          />
          <!-- ACC-120 slice 3 — the organisation-wide views' own filters, from
               the response's facets (the server's scope, never a client list). -->
          @if (showRecordTypeFilter()) {
            <app-overlay-select
              class="am-tl__filter"
              [options]="recordTypeOptions()"
              [placeholder]="'taskList.filter.recordType' | translate"
              [ariaLabel]="'taskList.filter.recordType' | translate"
              [showClear]="true"
              [ngModel]="recordTypeSel()"
              (ngModelChange)="recordTypeSel.set($event)"
              data-testid="filter-record-type"
            />
          }
          @if (showUnitFilter()) {
            <app-overlay-select
              class="am-tl__filter am-tl__filter--wide"
              [options]="unitOptions()"
              [placeholder]="'taskList.filter.unit' | translate"
              [ariaLabel]="'taskList.filter.unit' | translate"
              [showClear]="true"
              [ngModel]="unitSel()"
              (ngModelChange)="unitSel.set($event)"
              data-testid="filter-unit"
            />
          }
          @if (!isMine()) {
            <button type="button" class="am-tl__toggle" [attr.aria-pressed]="mine()" (click)="mine.set(!mine())" data-testid="filter-mine">
              {{ 'taskList.filter.mine' | translate }}
            </button>
          }
          @if (phone()) {
            <!-- ACC-234 — cards have no column headers, so a phone keeps a
                 compact sort menu: the headers' own sorts, both directions. -->
            <app-overlay-select
              class="am-tl__filter"
              [options]="phoneSortOptions()"
              [ngModel]="sort().key + ':' + sort().dir"
              (ngModelChange)="onPhoneSort($event)"
              [ariaLabel]="'taskList.sort.label' | translate"
              data-testid="task-list-sort-menu"
            />
          }
        </div>

        <div class="am-tl__chips" data-testid="task-list-chips">
          @for (chip of chips(); track chip.id) {
            <button
              type="button"
              class="am-tl__chip"
              [attr.aria-label]="'taskList.chip.remove' | translate: { filter: chip.label }"
              (click)="removeChip(chip.id)"
            >
              {{ chip.label }} <span aria-hidden="true">✕</span>
            </button>
          }
          @if (chips().length > 1 || (chips().length === 1 && chips()[0].id !== 'link')) {
            <button type="button" class="am-tl__clear" (click)="clearAll()" data-testid="task-list-clear">{{ 'taskList.chip.clearAll' | translate }}</button>
          }
          <span class="flex-1"></span>
          <span class="text-xs text-[var(--am-ink-700)]" aria-live="polite" data-testid="task-list-live">{{ liveText() }}</span>
        </div>
      }

      <div #scroller class="am-tl__scroll" data-testid="task-list-scroll" [attr.aria-busy]="phase() === 'loading'">
        @if (!phone() && phase() !== 'denied' && isMine()) {
          <!-- ACC-120 slice 3 — My tasks' columns (Task Screens): Task · record,
               Priority (plain text, not sortable), Due, Status, actions. -->
          <div class="am-tl__row am-tl__head" role="row" data-testid="task-list-head">
            <am-sort-header key="title" [label]="'tasks.sections.col.taskRecord' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <span role="columnheader" class="am-tl__tail" data-testid="task-list-col-priority">{{ 'task.priority.title' | translate }}</span>
            <am-sort-header key="due" [label]="'taskList.col.due' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <am-sort-header key="status" [label]="'taskList.col.status' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <span role="columnheader"><span class="sr-only">{{ 'taskList.col.actions' | translate }}</span></span>
          </div>
        } @else if (!phone() && phase() !== 'denied') {
          <!-- ACC-234 — a column the server sorts by is a header you press;
               the others are plain text. -->
          <div class="am-tl__row am-tl__head" role="row" data-testid="task-list-head">
            <am-sort-header key="title" [label]="'taskList.col.task' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <am-sort-header key="status" [label]="'taskList.col.status' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <span role="columnheader" class="am-tl__tail">{{ 'taskList.col.assignee' | translate }}</span>
            <am-sort-header key="due" [label]="'taskList.col.due' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <span role="columnheader" class="am-tl__tail">{{ 'taskList.col.createdBy' | translate }}</span>
            <am-sort-header key="updated" [label]="'taskList.col.updated' | translate" [current]="sort()" (sort)="sortBy($event)" />
            <span role="columnheader"><span class="sr-only">{{ 'taskList.col.actions' | translate }}</span></span>
          </div>
        }
        @switch (phase()) {
          @case ('loading') {
            @for (i of skeleton; track i) {
              <div class="am-tl__row" aria-hidden="true"><span class="[grid-column:1/-1] h-3.5 rounded bg-[var(--am-surface)]"></span></div>
            }
          }
          @case ('denied') {
            <!-- A 403: this viewer may not open this view. The server's sentence,
                 and no Retry: trying again cannot change the answer. -->
            <div class="flex flex-col items-start gap-1 px-4 py-6" role="alert" data-testid="task-list-denied">
              <p class="m-0 font-semibold">{{ 'taskList.denied.title' | translate }}</p>
              <p class="m-0 text-[12.5px] text-[var(--am-ink-700)]" data-testid="task-list-denied-reason">{{ deniedMessage() | translate }}</p>
            </div>
          }
          @case ('error') {
            <div class="flex flex-col items-start gap-2 px-4 py-6" role="alert" data-testid="task-list-error">
              <p class="m-0">{{ 'taskList.error' | translate }}</p>
              <button type="button" class="am-tl__btn" (click)="reload()">{{ 'list.retry' | translate }}</button>
            </div>
          }
          @default {
            @if (rows().length === 0) {
              <div class="flex flex-col items-start gap-2 px-4 py-6" data-testid="task-list-empty">
                @if (filtered()) {
                  <p class="m-0 font-semibold">
                    {{ (q() ? 'taskList.noMatchSearch' : 'taskList.noMatch') | translate: { q: q() } }}
                  </p>
                  <p class="m-0 text-[12.5px] text-[var(--am-ink-500)]">{{ countText('taskList.live.total', total()) }}</p>
                  <button type="button" class="am-tl__btn" (click)="clearAll()">{{ (q() && chips().length === 1 ? 'taskList.clearSearch' : 'taskList.chip.clearAll') | translate }}</button>
                } @else if (emptyKeys(); as keys) {
                  <p class="m-0 font-semibold">{{ keys.title | translate }}</p>
                  <p class="m-0 text-[12.5px] text-[var(--am-ink-500)]">{{ keys.body | translate }}</p>
                } @else {
                  <p class="m-0">{{ 'taskList.empty' | translate }}</p>
                }
              </div>
            }
            <ul class="list-none m-0 p-0" role="list">
              @for (r of rows(); track r.row.id) {
                <li
                  class="am-tl__row am-tl__item data-[overdue]:bg-[color-mix(in_srgb,var(--am-danger-bg)_55%,transparent)]"
                  [class.am-tl__item--card]="phone()"
                  [attr.data-overdue]="r.overdue ? '' : null"
                  [class.am-tl__item--sought]="highlightId() === r.row.id"
                  [attr.data-task-row]="r.row.id"
                  tabindex="-1"
                >
                  <span class="am-tl__task">
                    <span class="flex items-center gap-1.5 min-w-0">
                      <span class="am-tl__title" [attr.title]="r.title"><am-task-link [taskId]="r.row.id" [title]="r.title" /></span>
                      @if (r.tagKey) {
                        <span class="am-tl__tag">{{ r.tagKey | translate }}</span>
                      }
                    </span>
                    @if (phone()) {
                      @if (ownView() && r.recordName) {
                        <span class="am-tl__sub am-tl__tail">
                          @if (r.recordHref) {<a class="text-[var(--am-primary-700)] no-underline hover:underline focus-visible:outline-[length:var(--am-focus-ring-width)] focus-visible:outline-[var(--am-focus-ring)]" [routerLink]="r.recordHref" data-testid="task-list-record">{{ r.recordName }}</a>} @else {<span data-testid="task-list-record">{{ r.recordName }}</span>}
                        </span>
                      } @else if (r.recordLine) {
                        <span class="am-tl__sub am-tl__tail">{{ r.recordLine }}</span>
                      }
                      <span class="am-tl__sub">
                        <span class="am-tl__due whitespace-nowrap" [attr.data-tone]="r.due.tone">{{ r.due.text }}</span>
                        @if (isMine()) {
                          <span class="am-tl__tail"> · {{ r.priority.label }} · {{ r.statusKey | translate }}</span>
                        } @else {
                          <span class="am-tl__tail"> · {{ r.who }} · {{ r.statusKey | translate }}</span>
                        }
                        @if (r.overdue) {
                          <span class="flex-none text-[11px] font-semibold leading-[18px] px-1.5 whitespace-nowrap border border-[var(--am-danger-border)] rounded-[var(--am-radius-pill)] bg-[var(--am-danger-bg)] text-[var(--am-danger-ink)] ms-1" data-testid="task-list-overdue">{{ 'taskList.overdue' | translate }}</span>
                        }
                      </span>
                    } @else if (ownView() && r.recordName) {
                      <span class="am-tl__sub am-tl__tail" [attr.title]="r.subLine">
                        @if (r.recordHref) {<a class="text-[var(--am-primary-700)] no-underline hover:underline focus-visible:outline-[length:var(--am-focus-ring-width)] focus-visible:outline-[var(--am-focus-ring)]" [routerLink]="r.recordHref" data-testid="task-list-record">{{ r.recordName }}</a>} @else {<span data-testid="task-list-record">{{ r.recordName }}</span>}
                        @if (r.fact) {<span>&nbsp;· {{ r.fact }}</span>}
                      </span>
                    } @else if (r.subLine) {
                      <span class="am-tl__sub am-tl__tail" [attr.title]="r.subLine">{{ r.subLine }}</span>
                    }
                  </span>
                  @if (!phone() && isMine()) {
                    <span class="am-tl__tail" data-testid="task-list-priority">
                      @if (r.priority.glyph) {<span aria-hidden="true">{{ r.priority.glyph }}&nbsp;</span>}{{ r.priority.label }}
                    </span>
                    <span class="am-tl__due overflow-hidden" [attr.data-tone]="r.due.tone" data-testid="task-list-due">
                      <span class="flex flex-wrap -ms-[1em]">
                        @for (part of r.dueParts; track $index) {
                          <span class="am-tl__part relative min-w-0 ps-[1em] wrap-anywhere before:absolute before:start-0 before:w-[1em] before:text-center before:content-['·']">{{ part }}</span>
                        }
                      </span>
                    </span>
                    <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0" data-testid="task-list-status">
                      <span>{{ r.statusKey | translate }}</span>
                      @if (r.overdue) {
                        <span class="flex-none text-[11px] font-semibold leading-[18px] px-1.5 whitespace-nowrap border border-[var(--am-danger-border)] rounded-[var(--am-radius-pill)] bg-[var(--am-danger-bg)] text-[var(--am-danger-ink)]" data-testid="task-list-overdue">{{ 'taskList.overdue' | translate }}</span>
                      }
                    </span>
                  } @else if (!phone()) {
                    <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                      <span>{{ r.statusKey | translate }}</span>
                      @if (r.overdue) {
                        <span class="flex-none text-[11px] font-semibold leading-[18px] px-1.5 whitespace-nowrap border border-[var(--am-danger-border)] rounded-[var(--am-radius-pill)] bg-[var(--am-danger-bg)] text-[var(--am-danger-ink)]" data-testid="task-list-overdue">{{ 'taskList.overdue' | translate }}</span>
                      }
                    </span>
                    <span class="am-tl__task">
                      <span class="am-tl__tail" [attr.title]="r.who">{{ r.who }}</span>
                      @if (r.position) {
                        <span class="am-tl__sub am-tl__tail" [attr.title]="r.position">{{ r.position }}</span>
                      }
                    </span>
                    <!-- ACC-234 — the relative half, then the date; the date
                         takes line 2 when one line does not fit, and the "·"
                         between them is only drawn when they share a line. -->
                    <span class="am-tl__due overflow-hidden" [attr.data-tone]="r.due.tone" data-testid="task-list-due">
                      <span class="flex flex-wrap -ms-[1em]">
                        @for (part of r.dueParts; track $index) {
                          <span class="am-tl__part relative min-w-0 ps-[1em] wrap-anywhere before:absolute before:start-0 before:w-[1em] before:text-center before:content-['·']">{{ part }}</span>
                        }
                      </span>
                    </span>
                    <span class="am-tl__tail" [attr.title]="r.row.createdBy.name">{{ r.row.createdBy.name }}</span>
                    <span class="am-tl__tail">{{ r.row.updatedAt | amDate }}</span>
                  }
                  <span class="flex items-center justify-end gap-1">
                    @if (r.model.primary; as p) {
                      <button
                        type="button"
                        class="am-tl__btn am-tl__btn--primary"
                        [disabled]="p.disabled || busyId() === r.row.id"
                        [attr.aria-label]="(p.labelKey | translate) + ' ' + r.title"
                        [attr.title]="p.disabled ? ('task.completeNeedsEvidence' | translate) : null"
                        [attr.data-action]="p.id"
                        (click)="act(r.row, p.id)"
                      >
                        {{ p.labelKey | translate }}
                      </button>
                    }
                    <am-row-menu [groups]="r.menu" [label]="'taskActions.moreActionsFor' | translate: { title: r.title }" (picked)="act(r.row, asRowAction($event))" />
                  </span>
                  @if (rowErrors()[r.row.id]; as message) {
                    <span class="basis-full [grid-column:1/-1] text-xs text-[var(--am-danger-ink)]" role="alert">
                      {{ message }}
                      <button type="button" class="[font:inherit] border-0 bg-transparent p-0 underline cursor-pointer text-[var(--am-primary-700)]" (click)="retryRow(r.row)">{{ 'list.retry' | translate }}</button>
                    </span>
                  }
                </li>
              }
            </ul>
          }
        }
      </div>

      <div class="am-tl__foot" data-testid="task-list-foot">
        @if (phase() === 'ready') {
          <span>{{ footText() }}</span>
          <span class="flex-1"></span>
          @if (more() === 'failed') {
            <span class="text-[var(--am-danger-ink)]" role="alert">{{ 'taskList.live.loadMoreFailed' | translate }}</span>
            <button type="button" class="am-tl__btn" (click)="loadMore()">{{ 'list.retry' | translate }}</button>
          } @else if (rows().length < matching()) {
            <button type="button" class="am-tl__btn" [disabled]="more() === 'loading'" (click)="loadMore()" data-testid="task-list-more">
              {{ (more() === 'loading' ? 'taskList.live.loadingMore' : 'taskList.live.loadMore') | translate }}
            </button>
          }
        }
      </div>
    </div>

    <app-task-action-host (changed)="onChanged($event)" (failed)="onFailed($event)" (busyChange)="busyId.set($event)" />
  `,
  styles: [
    `
      :host{display:flex;flex-direction:column;flex:1 1 auto;min-block-size:0}
      .am-tl{display:flex;flex-direction:column;flex:1 1 auto;min-block-size:0;font-size:13px}
      .am-tl--page{block-size:max(420px,calc(100vh - 200px));border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised)}
      .am-tl__toolbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;border-block-end:1px solid var(--am-border)}
      .am-tl__search{flex:1 1 200px;display:flex;align-items:center;gap:6px;block-size:32px;padding:0 10px;border:1px solid var(--am-control-border);border-radius:var(--am-radius-control)}
      .am-tl__search input{flex:1;min-inline-size:0;border:0;outline:0;font:inherit;background:none}
      .am-tl__search:focus-within{outline:var(--am-focus-ring-width) solid var(--am-focus-ring)}
      /* A filter is as wide as its label: a fixed width cut "Required or
         optional" short. The toolbar wraps to a second row instead. */
      .am-tl__filter{flex:none;max-inline-size:100%}
      .am-tl__toggle,.am-tl__btn,.am-tl__chip,.am-tl__clear{font:inherit;font-size:12.5px;block-size:32px;padding:0 11px;border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-ink-900);cursor:pointer;white-space:nowrap}
      .am-tl__toggle[aria-pressed=true]{border-color:var(--am-primary-600);background:var(--am-primary-100);color:var(--am-primary-700);font-weight:600}
      .am-tl__chips{flex:none;display:flex;align-items:center;gap:6px;min-block-size:36px;padding:2px 16px;border-block-end:1px solid var(--am-border)}
      .am-tl__chip{block-size:24px;padding:0 9px;border-radius:var(--am-radius-pill);background:var(--am-primary-50);border-color:var(--am-primary-100)}
      .am-tl__clear{block-size:24px;border:0;background:none;color:var(--am-primary-700)}
      .am-tl__scroll{flex:1 1 auto;min-block-size:0;overflow:auto;position:relative}
      /* ACC-234 — THE COLUMNS, DEFINED ONCE, in this one rule. The header and
         every row are separate grids reading this track list, so a column
         starts at the same x in all of them only while NO track depends on
         its row's content. The action track was 'auto', so a row with a
         next-step button sized it wider than a row without one and every fr
         column shifted. It is fixed now, wide enough for the longest next
         step and the ⋯ in both languages. No cell paints outside its track.
         ACC-120 slice 3 — My tasks has its own five tracks (MINE_ROOT), set
         through the two variables; every other list keeps these. */
      .am-tl__row{display:grid;grid-template-columns:var(--am-tl-cols,minmax(170px,2.2fr) 96px minmax(120px,1.4fr) minmax(150px,1.2fr) minmax(90px,1fr) 92px 150px);gap:10px;align-items:center;min-inline-size:var(--am-tl-min,960px);box-sizing:border-box;padding:6px 16px;border-block-end:1px solid var(--am-border)}
      .am-tl__row>*{min-inline-size:0}
      .am-tl__head{position:sticky;inset-block-start:0;z-index:1;block-size:30px;padding-block:0;background:var(--am-surface);font-size:11.5px;font-weight:600;color:var(--am-ink-700)}
      .am-tl__item{min-block-size:52px}.am-tl__item:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:-2px}
      .am-tl__item--card{display:flex;flex-wrap:wrap;min-inline-size:0;min-block-size:60px;gap:4px 8px}
      .am-tl__item--card .am-tl__task{flex:1 1 0}
      .am-tl__item--sought{background:var(--am-primary-50);box-shadow:inset 3px 0 0 var(--am-primary-600)}
      .am-tl__task{display:flex;flex-direction:column;min-inline-size:0}
      .am-tl__title,.am-tl__tail{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-tl__sub{display:flex;min-inline-size:0;font-size:11.5px;color:var(--am-ink-500)}
      /* Due: the parts sit on one line when they fit and the date drops to
         line 2 when they do not; nothing is nowrap, so nothing overflows.
         Every part has a 1em start padding holding a "·", and the inner box
         starts 1em before the cell, which clips it: a part at the start of a
         line has its "·" in the clipped strip, a part following on the same
         line shows it. Padding, not an inline "·", so a part that wraps
         inside itself keeps every line in the cell. (The classes are on the
         cell, beside the markup.) */
      .am-tl__due[data-tone=danger]{color:var(--am-danger-ink);font-weight:600}.am-tl__due[data-tone=info]{color:var(--am-info-ink)}.am-tl__due[data-tone=muted]{color:var(--am-ink-500)}
      .am-tl__tag{flex:none;font-size:11px;font-weight:600;padding:0 6px;border-radius:var(--am-radius-pill);background:var(--am-surface);border:1px solid var(--am-border);color:var(--am-ink-700)}
      .am-tl__btn--primary{block-size:26px;font-weight:600;color:var(--am-primary-700);border-color:var(--am-primary-600)}
      .am-tl__btn:disabled{cursor:not-allowed;color:var(--am-ink-500);border-color:var(--am-border)}
      .am-tl__foot{flex:none;display:flex;align-items:center;gap:8px;block-size:44px;padding:0 16px;border-block-start:1px solid var(--am-border);color:var(--am-ink-700);font-size:12.5px}
      :host-context([dir=rtl]) .am-tl__foot{block-size:48px}:host-context([dir=rtl]) .am-tl__item{min-block-size:58px}:host-context([dir=rtl]) .am-tl__item--card{min-block-size:64px}
      button:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class TaskListViewComponent {
  private readonly tasks = inject(TaskService);
  private readonly text = inject(TaskRowText);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  /** A record's tasks; both absent means the organisation's (View all tasks, ACC-244). */
  readonly sourceType = input<string | null>(null);
  readonly sourceId = input<string | null>(null);
  /** A task to open at (a deep link): the list loads to it and highlights it. */
  readonly around = input<string | null>(null);
  readonly variant = input<'popup' | 'page'>('popup');
  /**
   * ACC-120 slice 3 — an organisation-wide view of /tasks (no record): All
   * tasks, Unit tasks or Unassigned. Null keeps today's request (the server's
   * default, All tasks).
   */
  readonly view = input<TaskRecordListView | null>(null);
  /** A record type to open filtered by (from a link); the toolbar changes it. */
  readonly recordType = input<string | null>(null);
  /** A unit to open filtered by (the unit view); the toolbar changes it. */
  readonly unit = input<string | null>(null);
  /** Offer the Unit filter: the viewer's unit scope has more than one top-level unit. */
  readonly unitFilter = input(false);
  /** An action to open on the `around` row once it is in view, if the row offers it (a Setup health Fix). */
  readonly openAction = input<'reassign' | null>(null);
  /** Something on the list changed — the panel behind refreshes when the popup closes. */
  readonly changed = output<void>();
  readonly totalChange = output<{ total: number; scope: 'all' | 'own' }>();
  /** Whether the server refused this view (a 403), so the host can hide what goes with it. */
  readonly deniedChange = output<boolean>();

  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  // ── The query ─────────────────────────────────────────────────────────
  readonly qInput = signal('');
  readonly q = signal('');
  readonly status = signal<TaskRecordListStatus | null>(null);
  /** ACC-120 slice 3 — the own views' pressed chip; "All open" by default, never none. */
  readonly statusChip = signal<StatusChipId>('OPEN');
  readonly overdue = signal(false);
  readonly who = signal<string | null>(null);
  readonly required = signal<'REQUIRED' | 'OPTIONAL' | null>(null);
  readonly due = signal<'THIS_WEEK' | 'LATER' | 'NONE' | null>(null);
  readonly mine = signal(false);
  readonly recordTypeSel = signal<string | null>(null);
  readonly unitSel = signal<string | null>(null);
  readonly sort = signal<SortState>(DEFAULT_SORT);

  // ── What came back ────────────────────────────────────────────────────
  readonly phase = signal<'loading' | 'ready' | 'error' | 'denied'>('loading');
  /** The server's sentence for a 403 (or a translation key when it sent none). */
  readonly deniedMessage = signal<string>('taskList.denied.fallback');
  readonly more = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly items = signal<ITaskRecordRowDto[]>([]);
  readonly total = signal(0);
  readonly matching = signal(0);
  readonly facets = signal<ITaskRecordListDto['facets']>(null);
  readonly highlightId = signal<string | null>(null);
  readonly linkTitle = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly rowErrors = signal<Record<string, string>>({});
  readonly phone = signal(false);
  protected readonly skeleton = Array.from({ length: 10 }, (_, i) => i);

  private lastAction: Record<string, TaskRowActionId> = {};
  private request: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private aroundPending: string | null = null;

  readonly query = computed<TaskRecordListQuery>(() => {
    const { key, dir } = this.sort();
    const sort = key as TaskRecordListSort;
    const who = this.who();
    return {
      sourceType: this.sourceType() ?? undefined,
      sourceId: this.sourceId() ?? undefined,
      q: this.q() || undefined,
      status: this.statusesSent(),
      overdue: this.overdue() || undefined,
      assignee: who?.startsWith('user:') ? who.slice(5) : undefined,
      pool: who?.startsWith('pool:') ? who.slice(5) : undefined,
      required: this.required() ?? undefined,
      due: this.due() ?? undefined,
      mine: this.mine() || undefined,
      // Only organisation-wide: the server refuses a view sent with a record.
      view: this.sourceType() ? undefined : (this.view() ?? undefined),
      recordType: this.recordTypeSel() ?? undefined,
      unit: this.unitSel() ?? undefined,
      sort,
      dir,
    };
  });

  /** ACC-120 slice 3 — the viewer's own views: My tasks and Created by me (never a record). */
  readonly ownView = computed<OwnView | null>(() => {
    const view = this.sourceType() ? null : this.view();
    return view === 'mine' || view === 'created' ? view : null;
  });

  /** ACC-120 slice 3 — My tasks: its own columns, no assignee filters, and it flows with the page. */
  readonly isMine = computed(() => this.ownView() === 'mine');
  /** The frame: My tasks', or the fixed-height page frame, or none (the popup). */
  readonly rootClass = computed(() => (this.isMine() ? MINE_ROOT : this.variant() === 'page' ? 'am-tl--page' : ''));

  /** The statuses the query sends: the pressed chip's on an own view, else the select's. */
  private statusesSent(): TaskRecordListStatus[] | undefined {
    const own = this.ownView();
    if (own) {
      const chip = this.statusChip();
      return chip === 'OPEN' ? [...OPEN_STATUSES[own]] : [chip];
    }
    return this.status() ? [this.status()!] : undefined;
  }

  /** A status narrows the list: any chip but "All open", or a chosen status. */
  private readonly statusFiltered = computed(() => (this.ownView() ? this.statusChip() !== 'OPEN' : !!this.status()));

  readonly filtered = computed(() => {
    const q = this.query();
    return !!(q.q || this.statusFiltered() || q.overdue || q.assignee || q.pool || q.required || q.due || q.mine || q.recordType || q.unit);
  });

  /**
   * The chips of the open own view, "All open" first, each with its count from
   * the first page's facets.statusCounts. "All open" is the sum of that view's
   * open set. No counts, no number: a chip never says 0 for "not told".
   */
  readonly statusChips = computed<{ id: StatusChipId; label: string; count: number | null }[]>(() => {
    this.translate.currentLang();
    const own = this.ownView();
    if (!own) return [];
    const counts = this.facets()?.statusCounts ?? null;
    const open = counts ? OPEN_STATUSES[own].reduce((sum, st) => sum + (counts[st] ?? 0), 0) : null;
    return [
      { id: 'OPEN' as const, label: this.translate.instant('taskList.filter.allOpen'), count: open },
      ...CHIP_STATUSES[own].map((st) => ({
        id: st,
        label: this.translate.instant(`task.status.${st.toLowerCase()}`),
        count: counts ? (counts[st] ?? 0) : null,
      })),
    ];
  });

  readonly rows = computed<ViewRow[]>(() => {
    this.translate.currentLang();
    const now = new Date();
    return this.items().map((row) => {
      const model = taskRowActions(row.actions, row.evidenceCount);
      const due = this.text.due(row, now);
      // Every two-part due text is "relative · date" in both languages, so
      // its first " · " is where line 2 starts.
      const cut = due.text.indexOf(' · ');
      const fact = this.text.fact(row);
      const recordLine = row.record ? this.recordLine(row.record) : null;
      const own = !!this.ownView();
      return {
        row,
        title: this.text.title(row),
        due,
        dueParts: cut < 0 ? [due.text] : [due.text.slice(0, cut), due.text.slice(cut + 3)],
        who: this.text.who(row),
        position: this.text.position(row),
        statusKey: this.text.statusKey(row),
        fact,
        tagKey: this.text.requirementKey(row),
        recordLine,
        subLine: [recordLine, fact].filter(Boolean).join(' · ') || null,
        recordName: own && row.record ? this.recordName(row.record) : null,
        recordHref: own && row.record ? this.recordHref(row.record) : null,
        overdue: own && isTaskOverdue(row, now),
        priority: this.priorityText(row.priority),
        model,
        menu: model.menu.map((group) =>
          group.map((a) => ({
            id: a.id,
            label: a.count !== undefined ? this.translate.instant(a.labelKey, { count: a.count }) : this.translate.instant(a.labelKey),
            sub: a.subKey ? this.translate.instant(a.subKey) : undefined,
            danger: a.danger,
            disabled: a.disabled,
          })),
        ),
      };
    });
  });

  // ── The toolbar's options ─────────────────────────────────────────────
  readonly statusOptions = computed(() => {
    this.translate.currentLang();
    return STATUSES.map((s) => ({ value: s, label: this.translate.instant(`task.status.${s.toLowerCase()}`) }));
  });
  readonly requiredOptions = computed(() => {
    this.translate.currentLang();
    return [
      { value: 'REQUIRED', label: this.translate.instant('taskList.tag.required') },
      { value: 'OPTIONAL', label: this.translate.instant('taskList.tag.optional') },
    ];
  });
  readonly dueOptions = computed(() => {
    this.translate.currentLang();
    return [
      { value: 'THIS_WEEK', label: this.translate.instant('taskList.filter.dueThisWeek') },
      { value: 'LATER', label: this.translate.instant('taskList.filter.dueLater') },
      { value: 'NONE', label: this.translate.instant('taskList.filter.dueNone') },
    ];
  });
  /** Record type: on the organisation-wide views that span types (All, Unit). */
  readonly showRecordTypeFilter = computed(() => !this.sourceType() && (this.view() === 'all' || this.view() === 'unit'));
  /** Unit: the unit view, for a viewer whose scope holds more than one top-level unit (plan §6). */
  readonly showUnitFilter = computed(() => !this.sourceType() && this.view() === 'unit' && this.unitFilter());
  readonly recordTypeOptions = computed(() => {
    this.translate.currentLang();
    return (this.facets()?.recordTypes ?? []).map((t) => ({ value: t, label: this.recordTypeName(t) }));
  });
  readonly unitOptions = computed(() => {
    this.translate.currentLang();
    return (this.facets()?.units ?? []).map((u) => ({ value: u.id, label: this.language.bilingual(u.nameEn, u.nameAr) }));
  });
  /** Why a view has no rows when nothing filters it: the view's own sentence. */
  readonly emptyKeys = computed<{ title: string; body: string } | null>(() => {
    const view = this.sourceType() ? null : this.view();
    return view ? { title: `taskList.emptyView.${view}.title`, body: `taskList.emptyView.${view}.body` } : null;
  });

  /** A phone's sort menu: each header's sort, ascending then descending. */
  readonly phoneSortOptions = computed(() => {
    this.translate.currentLang();
    return SORTABLE.flatMap((s) => {
      const column = this.translate.instant(s.labelKey);
      return [
        { value: `${s.key}:asc`, label: this.translate.instant('list.sortAscending', { column }) },
        { value: `${s.key}:desc`, label: this.translate.instant('list.sortDescending', { column }) },
      ];
    });
  });
  readonly whoOptions = computed(() => {
    this.translate.currentLang();
    const f = this.facets();
    if (!f) return [];
    const groups = [];
    if (f.people.length) {
      groups.push({ label: this.translate.instant('taskList.filter.people'), items: f.people.map((p) => ({ value: `user:${p.id}`, label: p.name })) });
    }
    if (f.pools.length) {
      groups.push({
        label: this.translate.instant('taskList.filter.pools'),
        items: f.pools.map((p) => ({
          value: `pool:${p.key}`,
          label: taskPoolLabel(p.pool, (en, ar) => this.language.bilingual(en, ar), this.language.isArabic()),
        })),
      });
    }
    return groups;
  });

  readonly chips = computed<Chip[]>(() => {
    this.translate.currentLang();
    const chips: Chip[] = [];
    const named = (key: string, value: string) => this.translate.instant(key, { value });
    if (this.linkTitle()) chips.push({ id: 'link', label: this.translate.instant('taskList.chip.link', { title: this.linkTitle() }) });
    if (this.q()) chips.push({ id: 'q', label: named('taskList.chip.search', this.q()) });
    const chip = this.ownView() ? this.statusChip() : null;
    const status = this.ownView() ? (chip === 'OPEN' ? null : chip) : this.status();
    if (status) chips.push({ id: 'status', label: named('taskList.chip.status', this.translate.instant(`task.status.${status.toLowerCase()}`)) });
    if (this.overdue()) chips.push({ id: 'overdue', label: this.translate.instant('taskList.filter.overdueOnly') });
    const who = this.who();
    if (who) {
      const label = this.whoOptions().flatMap((g) => g.items).find((o) => o.value === who)?.label ?? '';
      chips.push({ id: 'who', label: named('taskList.chip.who', label) });
    }
    const required = this.required();
    if (required) chips.push({ id: 'required', label: this.translate.instant(required === 'REQUIRED' ? 'taskList.tag.required' : 'taskList.tag.optional') });
    const due = this.due();
    if (due) {
      const key = due === 'THIS_WEEK' ? 'taskList.filter.dueThisWeek' : due === 'LATER' ? 'taskList.filter.dueLater' : 'taskList.filter.dueNone';
      chips.push({ id: 'due', label: named('taskList.chip.due', this.translate.instant(key)) });
    }
    if (this.mine()) chips.push({ id: 'mine', label: this.translate.instant('taskList.filter.mine') });
    const recordType = this.recordTypeSel();
    if (recordType) chips.push({ id: 'recordType', label: named('taskList.chip.recordType', this.recordTypeName(recordType)) });
    const unit = this.unitSel();
    if (unit) {
      const label = this.unitOptions().find((o) => o.value === unit)?.label ?? '';
      chips.push({ id: 'unit', label: named('taskList.chip.unit', label) });
    }
    return chips;
  });

  readonly liveText = computed(() => {
    this.translate.currentLang();
    if (this.phase() === 'loading') return this.translate.instant('taskList.live.loading');
    if (this.phase() === 'error' || this.phase() === 'denied') return '';
    return this.filtered() ? this.countText('taskList.live.match', this.matching()) : this.countText('taskList.live.total', this.total());
  });

  readonly footText = computed(() => {
    this.translate.currentLang();
    const shown = this.items().length;
    if (this.filtered()) return this.translate.instant('taskList.foot.matchOf', { matching: this.format.number(this.matching()), total: this.format.number(this.total()) });
    if (shown >= this.total()) return this.translate.instant('taskList.foot.all', { total: this.format.number(this.total()) });
    return this.translate.instant('taskList.foot.showing', { shown: this.format.number(shown), total: this.format.number(this.total()) });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const query = this.document.defaultView?.matchMedia?.(`(max-width: ${TASK_LIST_PHONE_BELOW_PX - 0.02}px)`);
    if (query) {
      this.phone.set(query.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      query.addEventListener('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }
    destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });

    // A record type or unit handed in (a link, a view switch) becomes the
    // toolbar's value; the toolbar changes it from there.
    effect(() => {
      const recordType = this.recordType();
      const unit = this.unit();
      untracked(() => {
        this.recordTypeSel.set(recordType);
        this.unitSel.set(unit);
      });
    });

    // Every change of the query starts again from the first page.
    let first = true;
    effect(() => {
      const q = this.query();
      untracked(() => {
        if (first) {
          first = false;
          this.aroundPending = this.around();
        }
        this.fetchFirst(q);
      });
    });

    afterNextRender(
      () => {
        if (this.variant() === 'popup' && !this.around()) this.searchBox()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  countText(key: 'taskList.live.match' | 'taskList.live.total', n: number): string {
    return this.format.count(key, n);
  }

  onSearch(value: string): void {
    this.qInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.q.set(value.trim()), SEARCH_DELAY_MS);
  }

  /**
   * A header pressed. The sort is part of the query, so the list reads again
   * from the first page with the search, filters and chips kept.
   */
  sortBy(key: string): void {
    this.sort.set(nextSort(this.sort(), key));
  }

  /** A phone's sort menu, as `key:dir`; clearing it returns to the default. */
  onPhoneSort(value: string | null): void {
    const [key, dir] = (value ?? '').split(':');
    this.sort.set(key && (dir === 'asc' || dir === 'desc') ? { key, dir } : DEFAULT_SORT);
  }

  removeChip(id: Chip['id']): void {
    switch (id) {
      case 'q':
        this.qInput.set('');
        this.q.set('');
        return;
      case 'status':
        // An own view goes back to "All open", never to no chip at all.
        this.statusChip.set('OPEN');
        return this.status.set(null);
      case 'overdue':
        return this.overdue.set(false);
      case 'who':
        return this.who.set(null);
      case 'required':
        return this.required.set(null);
      case 'due':
        return this.due.set(null);
      case 'mine':
        return this.mine.set(false);
      case 'recordType':
        return this.recordTypeSel.set(null);
      case 'unit':
        return this.unitSel.set(null);
      case 'link':
        this.linkTitle.set(null);
        this.highlightId.set(null);
        return;
    }
  }

  clearAll(): void {
    this.qInput.set('');
    this.q.set('');
    this.status.set(null);
    this.statusChip.set('OPEN');
    this.overdue.set(false);
    this.who.set(null);
    this.required.set(null);
    this.due.set(null);
    this.mine.set(false);
    this.recordTypeSel.set(null);
    this.unitSel.set(null);
    this.linkTitle.set(null);
    this.highlightId.set(null);
    this.searchBox()?.nativeElement.focus();
  }

  reload(): void {
    this.fetchFirst(this.query());
  }

  loadMore(): void {
    if (this.more() === 'loading') return;
    this.more.set('loading');
    this.request?.unsubscribe();
    this.request = this.tasks.getRecordList({ ...this.query(), take: PAGE, skip: this.items().length }).subscribe({
      next: (page) => {
        this.items.update((rows) => [...rows, ...page.items.filter((r) => !rows.some((x) => x.id === r.id))]);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.more.set('idle');
        this.continueToAround();
      },
      error: () => this.more.set('failed'),
    });
  }

  act(row: ITaskRecordRowDto, id: TaskRowActionId): void {
    this.lastAction[row.id] = id;
    this.rowErrors.update((e) => {
      const { [row.id]: _gone, ...rest } = e;
      return rest;
    });
    this.host()?.run(row, id);
  }

  retryRow(row: ITaskRecordRowDto): void {
    const id = this.lastAction[row.id];
    if (id) this.act(row, id);
  }

  onFailed(failure: TaskActionFailure): void {
    this.rowErrors.update((e) => ({ ...e, [failure.taskId]: failure.message }));
    this.refreshRow(failure.taskId);
  }

  onChanged(taskId: string): void {
    this.changed.emit();
    this.refreshRow(taskId);
  }

  protected readonly asRowAction = asRowAction;
  private readonly host = viewChild(TaskActionHostComponent);

  /**
   * Acting in place: the page the row sits on is read again and the row is
   * replaced where it is. A row that no longer matches the filters leaves.
   */
  private refreshRow(taskId: string): void {
    const index = this.items().findIndex((r) => r.id === taskId);
    if (index < 0) return;
    const skip = Math.floor(index / PAGE) * PAGE;
    this.tasks.getRecordList({ ...this.query(), take: PAGE, skip }).subscribe({
      next: (page) => {
        const fresh = page.items.find((r) => r.id === taskId);
        this.items.update((rows) => (fresh ? rows.map((r) => (r.id === taskId ? fresh : r)) : rows.filter((r) => r.id !== taskId)));
        if (page.facets) this.facets.set(page.facets);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.totalChange.emit({ total: page.total, scope: page.scope });
      },
    });
  }

  private fetchFirst(query: TaskRecordListQuery): void {
    this.request?.unsubscribe();
    this.phase.set('loading');
    this.more.set('idle');
    this.rowErrors.set({});
    const around = this.aroundPending ?? undefined;
    this.request = this.tasks.getRecordList({ ...query, take: PAGE, skip: 0, around }).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.facets.set(page.facets ?? this.facets());
        this.phase.set('ready');
        this.deniedChange.emit(false);
        this.totalChange.emit({ total: page.total, scope: page.scope });
        if (around) {
          this.aroundPending = null;
          this.aroundIndex = page.aroundIndex;
          this.continueToAround();
        }
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 403) {
          this.deniedMessage.set(extractErrorMessage(err, 'taskList.denied.fallback'));
          this.phase.set('denied');
          this.deniedChange.emit(true);
          return;
        }
        this.phase.set('error');
      },
    });
  }

  private aroundIndex: number | null = null;
  private aroundId: string | null = null;

  /** Loads further pages until the linked task is in the list, then shows it. */
  private continueToAround(): void {
    if (this.aroundIndex === null) return;
    const target = this.aroundId ?? this.around();
    if (this.items().length <= this.aroundIndex && this.items().length < this.matching()) {
      this.aroundId = target;
      this.loadMore();
      return;
    }
    this.aroundIndex = null;
    this.aroundId = null;
    const row = this.items().find((r) => r.id === target);
    if (!row || !target) return;
    this.highlightId.set(target);
    this.linkTitle.set(this.text.title(row));
    // Only when the server offers it on this row: a task assigned since the
    // link was made no longer offers Reassign, and nothing opens.
    if (this.openAction() === 'reassign' && row.actions.reassign) this.act(row, 'reassign');
    afterNextRender(
      () => {
        const el = this.scroller()?.nativeElement.querySelector<HTMLElement>(`[data-task-row="${target}"]`);
        el?.scrollIntoView({ block: 'center' });
        el?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** A record type as a person reads it; one this file does not know reads "Record". */
  recordTypeName(type: string): string {
    const key = `taskList.recordType.${type}`;
    const name = this.translate.instant(key);
    return name === key ? this.translate.instant('taskList.recordType.OTHER') : name;
  }

  /** "▲ High", "!! Critical", the others their word alone (task-row-display.ts). */
  private priorityText(priority: string): { glyph: string | null; label: string } {
    const key = taskPriorityKey(priority);
    const label = this.translate.instant(key);
    return { glyph: taskPriorityGlyph(priority), label: label === key ? priority : label };
  }

  /** ACC-120 slice 3 — the record's name in the reader's language, or its type word when the row carries none. */
  private recordName(record: NonNullable<ITaskRecordRowDto['record']>): string {
    return record.nameEn ? this.language.bilingual(record.nameEn, record.nameAr) : this.recordTypeWord(record.type);
  }

  /** Where the record opens, by the one rule (task-row-display.ts). */
  private recordHref(record: NonNullable<ITaskRecordRowDto['record']>): string[] | null {
    return taskRecordHref(record, (p) => this.access.hasPermission(p));
  }

  private recordTypeWord(type: string): string {
    return this.translate.instant(taskRecordTypeKey(type));
  }

  private recordLine(record: NonNullable<ITaskRecordRowDto['record']>): string {
    const type = this.recordTypeWord(record.type);
    return record.nameEn ? `${type} · ${this.language.bilingual(record.nameEn, record.nameAr)}` : type;
  }
}

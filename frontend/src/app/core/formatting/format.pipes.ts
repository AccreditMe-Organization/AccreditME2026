// ACC-94 — template access to FormatService, by meaning:
//
//   {{ task.dueAt | amDateTime }}   {{ item.createdAt | amDate }}
//   {{ checkedAt | amRelative }}    {{ openForMs | amDuration }}
//   {{ total | amNumber }}
//
// Impure, because the output depends on the language, the tenant zone and the
// user's calendar, none of which is an input. What keeps a view current when
// one of those changes — OnPush views included — is that transform() READS the
// context signals on every call: Angular subscribes the template to whatever
// signals its evaluation reads, and marks the view for check when they change.
// The memo below therefore reads them BEFORE deciding to reuse its text; a
// cached return that skipped the read would silently unsubscribe the view, and
// the next language switch would be missed (format.pipes.spec.ts proves this
// with an OnPush view of memoised pipes). Output is memoised per input and
// context, so a pass that changes nothing formats nothing.
import { Pipe, PipeTransform, inject } from '@angular/core';
import { FormatContext } from './format-context';
import { DateInput, FormatService } from './format.service';
import { PluralCatalog } from './plural-catalog';
import { PluralKey } from './plural-key';

abstract class ContextAwarePipe<T> implements PipeTransform {
  protected readonly format = inject(FormatService);
  private readonly context = inject(FormatContext);
  private lastKey: string | null = null;
  private lastValue = '';

  transform(value: T): string {
    const stamp = value instanceof Date ? value.getTime() : value;
    // Read, not peeked: see the note at the top of this file.
    const key = `${String(stamp)}|${this.context.language()}|${this.context.timeZone()}|${this.context.calendar()}`;
    if (key !== this.lastKey || this.isTimeRelative()) {
      this.lastKey = key;
      this.lastValue = this.render(value);
    }
    return this.lastValue;
  }

  protected abstract render(value: T): string;

  // relative() depends on "now" as well as its input, so it is never memoised.
  protected isTimeRelative(): boolean {
    return false;
  }
}

@Pipe({ name: 'amDate', pure: false })
export class AmDatePipe extends ContextAwarePipe<DateInput> {
  protected render(value: DateInput): string {
    return this.format.date(value);
  }
}

@Pipe({ name: 'amDateTime', pure: false })
export class AmDateTimePipe extends ContextAwarePipe<DateInput> {
  protected render(value: DateInput): string {
    return this.format.dateTime(value);
  }
}

@Pipe({ name: 'amRelative', pure: false })
export class AmRelativePipe extends ContextAwarePipe<DateInput> {
  protected render(value: DateInput): string {
    return this.format.relative(value);
  }

  protected override isTimeRelative(): boolean {
    return true;
  }
}

@Pipe({ name: 'amDuration', pure: false })
export class AmDurationPipe extends ContextAwarePipe<number | null | undefined> {
  protected render(value: number | null | undefined): string {
    return this.format.duration(value);
  }
}

// {{ openCount | amCount: 'shell.openConditions' }}
// {{ reassigned | amCount: 'user.tasksReassigned' : { name: user.name } }}
@Pipe({ name: 'amCount', pure: false })
export class AmCountPipe implements PipeTransform {
  private readonly format = inject(FormatService);
  private readonly context = inject(FormatContext);
  private readonly catalog = inject(PluralCatalog);
  private lastKey: string | null = null;
  private lastValue = '';

  transform(n: number | null | undefined, key: PluralKey, params?: Record<string, unknown>): string {
    // Read, not peeked — the catalogue too, so a count rendered before its
    // language file arrived updates when the file does.
    const memo = [n, key, JSON.stringify(params ?? {}), this.context.language(), this.catalog.revision()].join('|');
    if (memo !== this.lastKey) {
      this.lastKey = memo;
      this.lastValue = this.format.count(key, n, params);
    }
    return this.lastValue;
  }
}

@Pipe({ name: 'amNumber', pure: false })
export class AmNumberPipe extends ContextAwarePipe<number | null | undefined> {
  protected render(value: number | null | undefined): string {
    return this.format.number(value);
  }
}

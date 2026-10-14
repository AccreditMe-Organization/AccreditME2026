import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * ACC-228 — a task's title, linking to its own page (/tasks/:id). Every list
 * that names a task uses this, so the title is the way in everywhere: My tasks,
 * Unassigned, All tasks, a record's Tasks panel and Home.
 *
 * The server decides who may open the page; a viewer who reached a title in a
 * list can open it, because every list only shows tasks the viewer may see.
 */
@Component({
  selector: 'am-task-link',
  standalone: true,
  imports: [RouterLink],
  template: `<a class="am-task-link" [routerLink]="['/tasks', taskId()]">{{ title() }}</a>`,
  styles: [
    `
      :host {
        display: inline;
        min-width: 0;
      }
      .am-task-link {
        color: inherit;
        font-weight: 500;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .am-task-link:hover {
        color: var(--am-primary-700);
        text-decoration: underline;
      }
      .am-task-link:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
        border-radius: 2px;
      }
    `,
  ],
})
export class TaskLinkComponent {
  readonly taskId = input.required<string>();
  readonly title = input.required<string>();
}

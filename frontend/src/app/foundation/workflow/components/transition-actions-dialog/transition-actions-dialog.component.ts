import { Component, DestroyRef, EventEmitter, Input, Output, effect, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DialogModule } from 'primeng/dialog';
import { WorkflowTransitionDto } from '../../services/workflow-template.service';
import { WorkflowActionConfiguratorComponent } from '../workflow-action-configurator/workflow-action-configurator.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';

/**
 * A transition's automatic actions, in a dialog (ACC-271 PR 5b). Opened from a
 * transitions list row's ⋯ and from the transition panel's "Automatic actions".
 *
 * It is GIVEN the transition as the page has it now, never a copy taken when
 * it opened: the configurator's saves reload the template, and a dialog that
 * kept the object it was opened with went on showing the actions it had before
 * the save. Callers keep the transition's id and look it up in what they last
 * loaded.
 *
 * A protected workflow (the server's isProtected) passes [isProtected], so the
 * configurator shows the actions read-only, with its line saying why.
 *
 * ACC-120 slice 10 — a raw p-dialog, so it goes on the layer stack while open
 * and answers Escape itself (closeOnEscape is off). PrimeNG's own Escape closes
 * a dialog only while it holds the highest z-index, and a tooltip takes that:
 * once Remove action's confirm returned focus to the trash button, its tooltip
 * showed and Escape stopped closing the dialog at all. Registered when it
 * opens, before any confirm, so a confirm above it is still the top layer when
 * this runs and only the confirm closes.
 */
@Component({
  selector: 'am-transition-actions-dialog',
  standalone: true,
  imports: [TranslatePipe, DialogModule, WorkflowActionConfiguratorComponent],
  template: `
    <p-dialog
      [visible]="open()"
      (visibleChange)="setVisible($event)"
      [header]="'workflow.actions' | translate"
      [modal]="true"
      [closeOnEscape]="false"
      [style]="{ width: '560px' }"
    >
      @if (transition; as t) {
        <app-workflow-action-configurator
          [transitionId]="t.id"
          [actions]="t.actions ?? []"
          [isProtected]="isProtected"
          (changed)="changed.emit()"
        />
      }
    </p-dialog>
  `,
})
export class TransitionActionsDialogComponent {
  /** The transition as last loaded; null closes nothing, it only shows no configurator. */
  @Input() transition: WorkflowTransitionDto | null = null;
  @Input() isProtected = false;
  @Input()
  set visible(value: boolean) {
    this.open.set(value);
  }
  @Output() visibleChange = new EventEmitter<boolean>();
  /** An action was added, changed or removed: the caller reloads. */
  @Output() changed = new EventEmitter<void>();

  readonly open = signal(false);
  private layerId: number | null = null;

  constructor() {
    const layers = inject(LayerStackService);
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || this.layerId === null || !layers.isTop(this.layerId)) return;
      event.stopPropagation();
      this.setVisible(false);
    };
    document.addEventListener('keydown', onKeydown);
    effect(() => {
      if (this.open()) {
        if (this.layerId === null) this.layerId = layers.push();
      } else if (this.layerId !== null) {
        layers.remove(this.layerId);
        this.layerId = null;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      if (this.layerId !== null) layers.remove(this.layerId);
    });
  }

  setVisible(value: boolean): void {
    this.open.set(value);
    this.visibleChange.emit(value);
  }
}

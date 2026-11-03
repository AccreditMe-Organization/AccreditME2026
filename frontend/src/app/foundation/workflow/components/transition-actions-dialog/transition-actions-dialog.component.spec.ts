// ACC-120 slice 10 — the Actions dialog is a raw p-dialog, so it registers on
// the layer stack itself and answers Escape only while it is the top layer.
// Before this it was on no stack: PrimeNG's own Escape went by z-index, and
// once Remove action's confirm returned focus to the trash button, that
// button's tooltip held the top z-index and Escape no longer closed the dialog.
// ACC-271 PR 5b moved it out of the transitions list into its own component,
// shared by the list and the transition panel.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { TransitionActionsDialogComponent } from './transition-actions-dialog.component';
import { WorkflowTransitionDto } from '../../services/workflow-template.service';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { WorkflowActionConfiguratorComponent } from '../workflow-action-configurator/workflow-action-configurator.component';

const TRANSITION = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Approve',
  labelAr: null,
  kind: 'ADVANCE',
  isApprovalPath: false,
  actions: [{ id: 'a1', workflowTransitionId: 'transition-1', actionType: 'LOG_AUDIT', order: 10, isEnabled: true, configJson: null }],
} as unknown as WorkflowTransitionDto;

describe('TransitionActionsDialogComponent — a layer (ACC-120 slice 10, ACC-271 PR 5b)', () => {
  let fixture: ComponentFixture<TransitionActionsDialogComponent>;
  let component: TransitionActionsDialogComponent;
  let layers: LayerStackService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransitionActionsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
      ],
    });
    fixture = TestBed.createComponent(TransitionActionsDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transition', TRANSITION);
    layers = TestBed.inject(LayerStackService);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.p-dialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  const open = (): void => {
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  };
  const escape = (): void => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };

  it('holds a layer while open, and releases it on close', () => {
    expect(layers.depth()).withContext('nothing open yet').toBe(0);
    open();
    expect(component.open()).toBeTrue();
    expect(layers.depth()).toBe(1);

    component.setVisible(false);
    fixture.detectChanges();
    expect(layers.depth()).toBe(0);
  });

  it('one Escape closes it while it is the top layer, and says so', () => {
    const closed: boolean[] = [];
    component.visibleChange.subscribe((v) => closed.push(v));
    open();
    escape();
    expect(component.open()).toBeFalse();
    expect(closed).toEqual([false]);
    expect(layers.depth()).toBe(0);
  });

  it('Escape leaves it open while a layer above it (a confirm) owns Escape', () => {
    open();
    const confirmLayer = layers.push();
    escape();
    expect(component.open()).withContext('the confirm owns this Escape').toBeTrue();

    layers.remove(confirmLayer);
    escape();
    expect(component.open()).withContext('and the next one closes the dialog').toBeFalse();
  });

  it('ignores Escape while closed', () => {
    const spy = spyOn(component.visibleChange, 'emit').and.callThrough();
    escape();
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes [isProtected] to the configurator', async () => {
    fixture.componentRef.setInput('isProtected', true);
    open();
    await fixture.whenStable();
    const configurator = fixture.debugElement.query(By.directive(WorkflowActionConfiguratorComponent)).componentInstance as WorkflowActionConfiguratorComponent;
    expect(configurator.isProtected).toBeTrue();
    expect(configurator.transitionId).toBe('transition-1');
  });
});

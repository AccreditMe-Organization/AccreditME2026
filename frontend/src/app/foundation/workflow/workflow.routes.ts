import { Routes } from '@angular/router';

export const WORKFLOW_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/workflow-template-list/workflow-template-list.component').then(
        (m) => m.WorkflowTemplateListComponent,
      ),
  },
  {
    path: ':templateId/stages',
    loadComponent: () =>
      import('./components/workflow-stage-list/workflow-stage-list.component').then(
        (m) => m.WorkflowStageListComponent,
      ),
  },
];

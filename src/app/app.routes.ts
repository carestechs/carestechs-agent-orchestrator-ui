import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'runs' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'runs',
    canMatch: [authGuard],
    loadComponent: () =>
      import('./features/runs-list/runs-list.component').then((m) => m.RunsListComponent),
  },
  {
    path: 'runs/:id',
    canMatch: [authGuard],
    loadComponent: () =>
      import('./features/run-detail/run-detail.component').then((m) => m.RunDetailComponent),
  },
  { path: '**', redirectTo: 'runs' },
];

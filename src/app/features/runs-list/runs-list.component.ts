import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, interval } from 'rxjs';
import { filter, tap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { RunStatusBadgeComponent } from '../../shared/run-status-badge.component';
import { FullPageErrorComponent } from '../../shared/full-page-error.component';
import { RunsService } from '../../core/runs.service';
import { AgentsService } from '../../core/agents.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { Agent, Pagination, RunStatus, RunSummary } from '../../models';
import { formatRelativeTime } from './relative-time';

const STATUS_VALUES: RunStatus[] = ['running', 'paused', 'completed', 'failed', 'cancelled'];
const POLL_MS = 5000;
const PAGE_SIZE = 20;

@Component({
  selector: 'app-runs-list',
  standalone: true,
  imports: [RouterLink, FormsModule, RunStatusBadgeComponent, FullPageErrorComponent],
  templateUrl: './runs-list.component.html',
  styles: [],
})
export class RunsListComponent {
  private readonly runsService = inject(RunsService);
  private readonly agentsService = inject(AgentsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<RunStatus>('paused');
  readonly agentRef = signal<string | null>(null);
  readonly page = signal<number>(1);
  readonly pageSize = signal<number>(PAGE_SIZE);

  readonly runs = signal<RunSummary[]>([]);
  readonly pagination = signal<Pagination | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<ProblemDetailsError | null>(null);
  readonly agents = signal<Agent[]>([]);

  readonly query = computed(() => ({
    status: this.status(),
    agentRef: this.agentRef(),
    page: this.page(),
    pageSize: this.pageSize(),
  }));

  readonly sortedRuns = computed(() =>
    [...this.runs()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );

  readonly prevDisabled = computed(() => this.page() <= 1);
  readonly nextDisabled = computed(() => {
    const p = this.pagination();
    if (!p) return true;
    return this.page() * this.pageSize() >= p.totalCount;
  });

  // Monotonic id to discard stale poll responses that arrive after the
  // operator has changed filters (anti-race per plan T-016 edge cases).
  private requestId = 0;
  private visibilityHandler: (() => void) | null = null;

  readonly statusOptions = STATUS_VALUES;

  formatRelative(iso: string): string {
    return formatRelativeTime(iso);
  }

  constructor() {
    this.seedFromQueryParams();

    void this.loadAgents();

    // URL sync runs on the explicit setters (onStatusChange / onAgentChange /
    // prev / next). We deliberately do NOT use an `effect()` here: a reactive
    // navigation queued mid-render races with RouterLink clicks and silently
    // cancels them. Tested via the e2e suite — clicking a row to /runs/:id
    // would otherwise snap back to /runs.

    // Initial load (the effect won't fire until a signal write).
    void this.load();

    interval(POLL_MS)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        tap(() => void this.load(true)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    const handler = (): void => {
      if (document.visibilityState === 'visible') void this.load(true);
    };
    document.addEventListener('visibilitychange', handler);
    this.visibilityHandler = handler;
    this.destroyRef.onDestroy(() => {
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
      }
    });
  }

  onStatusChange(s: RunStatus): void {
    this.page.set(1);
    this.status.set(s);
    this.syncUrlAndReload();
  }

  onAgentChange(value: string): void {
    this.page.set(1);
    this.agentRef.set(value || null);
    this.syncUrlAndReload();
  }

  prev(): void {
    if (!this.prevDisabled()) {
      this.page.update((p) => p - 1);
      this.syncUrlAndReload();
    }
  }

  next(): void {
    if (!this.nextDisabled()) {
      this.page.update((p) => p + 1);
      this.syncUrlAndReload();
    }
  }

  private syncUrlAndReload(): void {
    this.syncUrl(this.query());
    void this.load();
  }

  onRetry(): void {
    this.error.set(null);
    this.loading.set(true);
    void this.load();
  }

  private seedFromQueryParams(): void {
    const map = this.route.snapshot.queryParamMap;
    const s = map.get('status');
    if (s && (STATUS_VALUES as string[]).includes(s)) this.status.set(s as RunStatus);
    const a = map.get('agentRef');
    if (a) this.agentRef.set(a);
    const pageStr = map.get('page');
    if (pageStr) {
      const n = parseInt(pageStr, 10);
      if (Number.isFinite(n) && n >= 1) this.page.set(n);
    }
  }

  private syncUrl(q: ReturnType<RunsListComponent['query']>): void {
    const queryParams: Record<string, string | null> = {
      status: q.status,
      agentRef: q.agentRef ?? null,
      page: String(q.page),
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private async load(silent = false): Promise<void> {
    if (!silent) {
      // Keep the skeleton only on the very first load — polling and filter
      // changes shouldn't flicker the table.
      if (this.runs().length === 0) this.loading.set(true);
    }
    const id = ++this.requestId;
    try {
      const filters = {
        status: this.status(),
        agentRef: this.agentRef() ?? undefined,
        page: this.page(),
        pageSize: this.pageSize(),
      };
      const result = await firstValueFrom(this.runsService.list(filters));
      if (id !== this.requestId) return;
      this.runs.set(result.data);
      this.pagination.set(result.meta);
      this.error.set(null);
    } catch (err) {
      if (id !== this.requestId) return;
      if (err instanceof ProblemDetailsError) {
        this.error.set(err);
      } else {
        this.error.set(
          new ProblemDetailsError({
            type: 'about:blank',
            title: 'Could not load runs',
            status: 0,
            code: 'unknown',
          }),
        );
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  private async loadAgents(): Promise<void> {
    try {
      const list = await firstValueFrom(this.agentsService.list());
      this.agents.set(list);
    } catch {
      // Non-blocking — agentRef dropdown stays empty; runs table still works.
      this.agents.set([]);
    }
  }
}

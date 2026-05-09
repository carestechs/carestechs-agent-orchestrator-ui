// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RunStatusBadgeComponent, type BadgeStatus } from './run-status-badge.component';

beforeEach(() => {
  TestBed.configureTestingModule({});
});

interface BadgeCase {
  status: BadgeStatus;
  bg: string;
  text: string;
  label: string;
}

const cases: BadgeCase[] = [
  { status: 'running', bg: 'bg-sky-100', text: 'text-sky-700', label: 'Running' },
  { status: 'paused', bg: 'bg-amber-100', text: 'text-amber-700', label: 'Paused' },
  { status: 'completed', bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
  { status: 'failed', bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
  { status: 'cancelled', bg: 'bg-slate-200', text: 'text-slate-600', label: 'Cancelled' },
];

describe('RunStatusBadgeComponent', () => {
  for (const c of cases) {
    it(`maps ${c.status} to the documented bg/text classes and label`, () => {
      const fixture = TestBed.createComponent(RunStatusBadgeComponent);
      fixture.componentRef.setInput('status', c.status);
      fixture.detectChanges();
      const span = fixture.nativeElement.querySelector('span') as HTMLElement;
      expect(span.textContent?.trim()).toBe(c.label);
      expect(span.className).toContain(c.bg);
      expect(span.className).toContain(c.text);
    });
  }
});

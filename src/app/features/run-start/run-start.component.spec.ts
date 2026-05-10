// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RunStartComponent } from './run-start.component';

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('RunStartComponent', () => {
  it('mounts and renders the page-shell with a Cancel anchor pointing at /runs', () => {
    TestBed.configureTestingModule({
      imports: [RunStartComponent],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(RunStartComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="run-start"]')).not.toBeNull();

    const cancel = root.querySelector('[data-testid="cancel-button"]') as HTMLAnchorElement | null;
    expect(cancel).not.toBeNull();
    // RouterLink resolves to an href on the anchor.
    expect(cancel?.getAttribute('href')).toBe('/runs');
  });

  it('exposes submitting and error signals defaulting to false / null', () => {
    TestBed.configureTestingModule({
      imports: [RunStartComponent],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(RunStartComponent);
    expect(fixture.componentInstance.submitting()).toBe(false);
    expect(fixture.componentInstance.error()).toBeNull();
  });
});

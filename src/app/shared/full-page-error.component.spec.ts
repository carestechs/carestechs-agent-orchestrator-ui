// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FullPageErrorComponent } from './full-page-error.component';

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('FullPageErrorComponent', () => {
  it('renders the title input', () => {
    const fixture = TestBed.createComponent(FullPageErrorComponent);
    fixture.componentRef.setInput('title', 'Upstream unavailable');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Upstream unavailable');
  });

  it('hides the Retry button when no callback is provided', () => {
    const fixture = TestBed.createComponent(FullPageErrorComponent);
    fixture.componentRef.setInput('title', 't');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('invokes the retry callback exactly once on click', () => {
    const retry = vi.fn();
    const fixture = TestBed.createComponent(FullPageErrorComponent);
    fixture.componentRef.setInput('title', 't');
    fixture.componentRef.setInput('retry', retry);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

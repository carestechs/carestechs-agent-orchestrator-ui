// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ConfirmModalService } from './confirm-modal.service';

let svc: ConfirmModalService;

beforeEach(() => {
  TestBed.configureTestingModule({});
  svc = TestBed.inject(ConfirmModalService);
});

describe('ConfirmModalService', () => {
  it('resolves true when confirm() is called', async () => {
    const promise = svc.open({ title: 'Cancel run?' });
    svc.confirm();
    await expect(promise).resolves.toBe(true);
    expect(svc.state()).toBeNull();
  });

  it('resolves false when cancel() is called', async () => {
    const promise = svc.open({ title: 'Cancel run?' });
    svc.cancel();
    await expect(promise).resolves.toBe(false);
  });

  it('uses default labels and danger variant when not provided', () => {
    void svc.open({ title: 'Cancel run?' });
    const s = svc.state();
    expect(s?.opts.confirmLabel).toBe('Confirm');
    expect(s?.opts.cancelLabel).toBe('Cancel');
    expect(s?.opts.variant).toBe('danger');
    svc.cancel();
  });

  it('cancels the previous dialog when a second open() arrives', async () => {
    const first = svc.open({ title: 'A' });
    void svc.open({ title: 'B' });
    await expect(first).resolves.toBe(false);
    expect(svc.state()?.opts.title).toBe('B');
    svc.cancel();
  });
});

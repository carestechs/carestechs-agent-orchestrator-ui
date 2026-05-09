import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

let svc: ToastService;

beforeEach(() => {
  vi.useFakeTimers();
  TestBed.configureTestingModule({});
  svc = TestBed.inject(ToastService);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastService', () => {
  it('queues a success toast and auto-dismisses after 4s', () => {
    svc.success('Saved');
    expect(svc.toasts().length).toBe(1);
    vi.advanceTimersByTime(3999);
    expect(svc.toasts().length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(svc.toasts().length).toBe(0);
  });

  it('keeps error toasts until manually dismissed', () => {
    svc.error('Boom');
    expect(svc.toasts().length).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(svc.toasts().length).toBe(1);
    svc.dismiss(svc.toasts()[0]!.id);
    expect(svc.toasts().length).toBe(0);
  });

  it('deduplicates identical info toasts within a 1s window', () => {
    svc.info('Stream reconnected');
    svc.info('Stream reconnected');
    expect(svc.toasts().length).toBe(1);
    vi.advanceTimersByTime(1100);
    svc.info('Stream reconnected');
    expect(svc.toasts().length).toBe(2);
  });

  it('dismisses by id without affecting other toasts', () => {
    svc.success('A');
    svc.success('B');
    expect(svc.toasts().length).toBe(2);
    svc.dismiss(svc.toasts()[0]!.id);
    expect(svc.toasts().length).toBe(1);
    expect(svc.toasts()[0]!.title).toBe('B');
  });
});

import { describe, it, expect } from 'vitest';
import { FormControl } from '@angular/forms';
import { parseIntake, intakeJsonValidator, maxStepsValidator } from './intake-json.validator';

describe('parseIntake', () => {
  it('accepts a valid JSON object', () => {
    const r = parseIntake('{ "featureBriefPath": "x.md" }');
    expect(r.valid).toBe(true);
    expect(r.parsed).toEqual({ featureBriefPath: 'x.md' });
  });

  it('accepts a JSON object with leading/trailing whitespace', () => {
    const r = parseIntake('   \n  {"a": 1}  \n');
    expect(r.valid).toBe(true);
    expect(r.parsed).toEqual({ a: 1 });
  });

  it('rejects an empty string with a "required" message', () => {
    const r = parseIntake('');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/required/i);
  });

  it('rejects whitespace-only as required', () => {
    const r = parseIntake('   \n  ');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/required/i);
  });

  it('rejects an array — orchestrator intake must be an object', () => {
    const r = parseIntake('[1, 2, 3]');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/object/i);
  });

  it('rejects a primitive', () => {
    const r = parseIntake('42');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/object/i);
  });

  it('rejects null', () => {
    const r = parseIntake('null');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/object/i);
  });

  it('returns the parser error message for malformed JSON', () => {
    const r = parseIntake('{ "a":');
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('intakeJsonValidator', () => {
  it('returns null on a valid JSON object control value', () => {
    const ctrl = new FormControl('{ "a": 1 }');
    expect(intakeJsonValidator(ctrl)).toBeNull();
  });

  it('returns an intakeJson error key on invalid input', () => {
    const ctrl = new FormControl('{not json');
    const result = intakeJsonValidator(ctrl);
    expect(result).not.toBeNull();
    expect(result!['intakeJson']).toBeTruthy();
  });

  it('treats non-string control values as empty', () => {
    const ctrl = new FormControl(null);
    const result = intakeJsonValidator(ctrl);
    expect(result).not.toBeNull();
    expect(result!['intakeJson']).toMatch(/required/i);
  });
});

describe('maxStepsValidator', () => {
  it('accepts null / undefined as "blank → omit"', () => {
    expect(maxStepsValidator(null)).toBeNull();
    expect(maxStepsValidator(undefined)).toBeNull();
  });

  it('accepts a positive integer', () => {
    expect(maxStepsValidator(1)).toBeNull();
    expect(maxStepsValidator(200)).toBeNull();
  });

  it('rejects zero and negatives', () => {
    expect(maxStepsValidator(0)).toMatch(/positive/i);
    expect(maxStepsValidator(-3)).toMatch(/positive/i);
  });

  it('rejects non-integers', () => {
    expect(maxStepsValidator(1.5)).toMatch(/positive/i);
  });
});

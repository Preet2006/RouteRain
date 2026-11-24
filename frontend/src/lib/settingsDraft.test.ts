import { describe, expect, it } from 'vitest';

import { hasErrors, isDirty, sameDraft, toDraft, validateDraft, type Draft } from './settingsDraft';
import { DEFAULT_PROFILE, type Profile } from './storage';

const place = (label = 'Cyber Hub', lat = 28.4951, lon = 77.0891) => ({ label, lat, lon });
const base: Profile = { ...DEFAULT_PROFILE, name: 'Tanish', home: place('Sector 29', 28.467, 77.065), work: place() };
const draft = (over: Partial<Draft> = {}): Draft => ({ ...toDraft(base), ...over });
const none = { home: false, work: false };

describe('toDraft', () => {
  it('takes only the editable fields', () => {
    expect(Object.keys(toDraft({ ...base, onboarded: true, recentTrips: [] })).sort()).toEqual(['caution', 'home', 'language', 'name', 'voiceOn', 'work']);
  });
});

describe('sameDraft / isDirty', () => {
  it('an untouched draft is not dirty, even through a copied place object', () => {
    expect(sameDraft(draft(), toDraft(base))).toBe(true);
    expect(isDirty(draft({ home: { ...base.home! } }), toDraft(base), none)).toBe(false);
  });
  it.each([
    ['name', { name: 'Aryan' }],
    ['home cleared', { home: null }],
    ['home changed', { home: place('Sector 56', 28.4, 77.1) }],
    ['work moved a little', { work: place('Cyber Hub', 28.4952, 77.0891) }],
    ['voice off', { voiceOn: false }],
    ['language', { language: 'hi' as const }],
    ['caution', { caution: 'balanced' as const }],
  ])('%s is a change', (_n, over) => {
    expect(isDirty(draft(over), toDraft(base), none)).toBe(true);
  });
  it('place text typed but not chosen counts as unsaved', () => {
    expect(isDirty(draft(), toDraft(base), { home: true, work: false })).toBe(true);
    expect(isDirty(draft(), toDraft(base), { home: false, work: true })).toBe(true);
  });
  it('putting a value back removes the change', () => {
    expect(isDirty(draft({ name: 'X' }), toDraft(base), none)).toBe(true);
    expect(isDirty(draft({ name: 'Tanish' }), toDraft(base), none)).toBe(false);
  });
});

describe('validateDraft', () => {
  it('accepts a normal draft, an empty name and cleared places', () => {
    expect(validateDraft(draft(), none)).toEqual({});
    expect(validateDraft(draft({ name: '', home: null, work: null }), none)).toEqual({});
  });
  it('allows exactly 40 characters of name and refuses 41', () => {
    expect(validateDraft(draft({ name: 'a'.repeat(40) }), none)).toEqual({});
    expect(validateDraft(draft({ name: 'a'.repeat(41) }), none).name).toMatch(/at most 40 characters/);
  });
  it('measures the name after trimming spaces', () => {
    expect(validateDraft(draft({ name: ` ${'a'.repeat(40)} ` }), none)).toEqual({});
  });
  it('refuses a place the user typed but did not choose, with advice', () => {
    const e = validateDraft(draft({ home: null }), { home: true, work: false });
    expect(e.home).toMatch(/choose a place from the suggestions/i);
    expect(e.work).toBeUndefined();
  });
  it.each([
    ['empty label', place('  ')],
    ['latitude out of range', place('X', 123, 77)],
    ['longitude out of range', place('X', 28, 200)],
    ['not a number', place('X', Number.NaN, 77)],
    ['label too long', place('x'.repeat(121))],
  ])('refuses an invalid place: %s', (_n, p) => {
    expect(validateDraft(draft({ work: p }), none).work).toMatch(/real place/i);
    expect(validateDraft(draft({ home: p }), none).home).toMatch(/real place/i);
  });
  it('hasErrors', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ name: 'x' })).toBe(true);
  });
});

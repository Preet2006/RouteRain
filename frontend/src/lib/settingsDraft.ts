/** Pure logic for the Settings draft: what counts as a change, and what is allowed to be saved. */
import { MAX_NAME_LENGTH, type Profile, type SavedPlace } from './storage';

/** The profile fields Settings can edit. recent trips, onboarding and version are not part of the draft. */
export type Draft = Pick<Profile, 'name' | 'home' | 'work' | 'voiceOn' | 'language' | 'caution'>;

export const toDraft = (p: Profile): Draft => ({
  name: p.name, home: p.home, work: p.work, voiceOn: p.voiceOn, language: p.language, caution: p.caution,
});

const samePlace = (a: SavedPlace | null, b: SavedPlace | null) =>
  a === b || (!!a && !!b && a.label === b.label && a.lat === b.lat && a.lon === b.lon);

export function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name && samePlace(a.home, b.home) && samePlace(a.work, b.work) &&
    a.voiceOn === b.voiceOn && a.language === b.language && a.caution === b.caution
  );
}

/** pending = text was typed into a place box but no place was chosen. */
export type Pending = { home: boolean; work: boolean };

/** Unsaved changes: the draft differs from what is saved, or place text has been typed but not resolved. */
export const isDirty = (draft: Draft, saved: Draft, pending: Pending) => !sameDraft(draft, saved) || pending.home || pending.work;

export type Errors = { name?: string; home?: string; work?: string };

const PENDING_MESSAGE = 'Choose a place from the suggestions, press “Search the full map”, or clear the box.';

function placeProblem(p: SavedPlace | null): boolean {
  if (p === null) return false; // empty is allowed: it clears the saved place
  return !(p.label.trim().length > 0 && p.label.length <= 120 && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180);
}

export function validateDraft(d: Draft, pending: Pending): Errors {
  const errors: Errors = {};
  if (d.name.trim().length > MAX_NAME_LENGTH) errors.name = `Your name can be at most ${MAX_NAME_LENGTH} characters.`;
  if (pending.home) errors.home = PENDING_MESSAGE;
  else if (placeProblem(d.home)) errors.home = 'Home must be a real place. Choose it again.';
  if (pending.work) errors.work = PENDING_MESSAGE;
  else if (placeProblem(d.work)) errors.work = 'Work must be a real place. Choose it again.';
  return errors;
}

export const hasErrors = (e: Errors) => Object.keys(e).length > 0;

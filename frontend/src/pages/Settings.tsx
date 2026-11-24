import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PlaceField } from '@/components/PlaceField';
import { PreferenceFields } from '@/components/PreferenceFields';
import { UnsavedGuard } from '@/components/UnsavedGuard';
import { hasErrors, isDirty, toDraft, validateDraft, type Draft, type Pending } from '@/lib/settingsDraft';
import { MAX_NAME_LENGTH } from '@/lib/storage';
import { useProfile } from '@/lib/useProfile';

const TOAST_MS = 3500;

/**
 * Settings edit a DRAFT copy of the profile. Nothing is stored until Save changes is pressed; Cancel puts the saved
 * values back. Leaving with unsaved changes asks first. "Clear my data" is separate, with its own confirmation.
 */
export function Settings() {
  const { profile, store } = useProfile();
  const navigate = useNavigate();
  const saved = toDraft(profile);
  const [draft, setDraft] = useState<Draft>(saved);
  const [pending, setPending] = useState<Pending>({ home: false, work: false });
  const [toast, setToast] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const dirty = isDirty(draft, saved, pending);
  const errors = validateDraft(draft, pending);
  const invalid = hasErrors(errors);

  // Latest values for the navigation guard and the unload handler (they must not see stale state).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leavingRef = useRef(false);

  // Closing or reloading the tab can only be guarded by the browser's own prompt.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setToast(null);
  };

  function save() {
    if (invalid) {
      setShowErrors(true);
      return;
    }
    const clean = { ...draft, name: draft.name.trim() };
    store.update(clean);
    setDraft(clean); // the draft now equals what was saved, so Save goes back to disabled
    setShowErrors(false);
    setToast(store.isPersistent() ? 'Settings saved' : 'Settings saved for this session only: this browser is blocking storage');
  }

  function cancel() {
    setDraft(saved);
    setPending({ home: false, work: false });
    setShowErrors(false);
    setToast(null);
  }

  return (
    <div className="rr-settings-page">
      <UnsavedGuard shouldBlock={() => dirtyRef.current && !leavingRef.current} />
      <div className="rr-text">
        <h1>Settings</h1>
        <p className={store.isPersistent() ? 'rr-muted' : 'rr-note'} role={store.isPersistent() ? undefined : 'status'}>
          {store.isPersistent()
            ? 'Your name, saved places and preferences are kept on this device only. Nothing is sent to an account. Changes apply when you press Save changes.'
            : 'This browser is blocking storage, so your settings only last until you close this tab.'}
        </p>

        <div className="rr-text-grid rr-settings-grid">
          <section className="rr-card" aria-labelledby="s-you">
            <h2 id="s-you">You</h2>
            <div className="rr-field">
              <label htmlFor="settings-name">Name</label>
              <input
                id="settings-name"
                type="text"
                autoComplete="given-name"
                maxLength={MAX_NAME_LENGTH}
                aria-invalid={showErrors && !!errors.name}
                aria-describedby={showErrors && errors.name ? 'name-error' : undefined}
                value={draft.name}
                onChange={(e) => edit({ name: e.target.value })}
              />
              {showErrors && errors.name && <small id="name-error" role="alert" className="rr-field-error">{errors.name}</small>}
            </div>
            <PlaceField
              label="Home"
              value={draft.home}
              onChange={(home) => edit({ home })}
              onPendingChange={(home) => setPending((p) => (p.home === home ? p : { ...p, home }))}
              error={showErrors ? errors.home : undefined}
            />
            <PlaceField
              label="Work"
              value={draft.work}
              onChange={(work) => edit({ work })}
              onPendingChange={(work) => setPending((p) => (p.work === work ? p : { ...p, work }))}
              error={showErrors ? errors.work : undefined}
            />
          </section>

          <section className="rr-card" aria-labelledby="s-pref">
            <h2 id="s-pref">Preferences</h2>
            <PreferenceFields value={draft} onChange={(patch) => edit(patch)} />
          </section>

          <section className="rr-card rr-span-all" aria-labelledby="s-data">
            <h2 id="s-data">Your data</h2>
            {profile.recentTrips.length > 0 && (
              <p className="rr-muted">{profile.recentTrips.length} recent trip{profile.recentTrips.length === 1 ? '' : 's'} saved on this device.</p>
            )}
            {!confirming ? (
              <button type="button" className="rr-btn" onClick={() => setConfirming(true)}>Clear my data</button>
            ) : (
              <div role="alertdialog" aria-label="Confirm clearing your data" className="rr-confirm">
                <p>This removes your name, saved places and preferences from this device, including anything unsaved above. You will see the entry screen again.</p>
                <div className="rr-actions">
                  <button
                    type="button"
                    className="rr-btn danger"
                    onClick={() => {
                      leavingRef.current = true; // clearing is its own confirmed action: no second "discard" prompt
                      store.clear();
                      navigate('/', { replace: true });
                    }}>
                    Yes, clear everything
                  </button>
                  <button type="button" className="rr-btn" onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>
        <p className="rr-caveat-line">A guide, not a guarantee.</p>
      </div>

      <div className="rr-savebar" role="region" aria-label="Save settings">
        <p className={`rr-savebar-status${dirty ? ' dirty' : ''}`} aria-live="polite">
          {showErrors && invalid
            ? 'Fix the highlighted fields to save.'
            : dirty
              ? 'You have unsaved changes.'
              : 'No unsaved changes.'}
        </p>
        <div className="rr-actions">
          <button type="button" className="rr-btn" onClick={cancel} disabled={!dirty}>Cancel</button>
          <button type="button" className="rr-btn primary" onClick={save} disabled={!dirty}>Save changes</button>
        </div>
      </div>

      {toast && <div className="rr-toast" role="status">{toast}</div>}
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PlaceField } from '@/components/PlaceField';
import { PreferenceFields } from '@/components/PreferenceFields';
import { MAX_NAME_LENGTH, type SavedPlace } from '@/lib/storage';
import { useProfile } from '@/lib/useProfile';

const STEPS = ['Your name', 'Home and work', 'Voice and caution'] as const;

/** Three short steps, all optional, all editable later in Settings. */
export function Setup() {
  const { profile, store } = useProfile();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [home, setHome] = useState<SavedPlace | null>(profile.home);
  const [work, setWork] = useState<SavedPlace | null>(profile.work);
  const [prefs, setPrefs] = useState({ voiceOn: profile.voiceOn, language: profile.language, caution: profile.caution });
  const last = step === STEPS.length - 1;

  function finish() {
    store.update({ name: name.trim(), home, work, ...prefs, onboarded: true });
    navigate('/ready', { replace: true });
  }
  function skip() {
    store.update({ onboarded: true }); // keep the defaults, nothing else is saved
    navigate('/', { replace: true });
  }

  return (
    <div className="rr-hero rr-setup">
      <div>
        <p className="rr-muted" aria-live="polite">Step {step + 1} of {STEPS.length}</p>
        <h1>{STEPS[step]}</h1>

        {step === 0 && (
          <div className="rr-field">
            <label htmlFor="setup-name">What’s your name? (optional)</label>
            <input
              id="setup-name"
              type="text"
              autoComplete="given-name"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tanish"
            />
            <small className="rr-muted">Used for the greeting and the spoken advice. It stays on this device.</small>
          </div>
        )}

        {step === 1 && (
          <>
            <PlaceField label="Home (optional)" value={home} onChange={setHome} placeholder="e.g. Sector 29" />
            <PlaceField label="Work (optional)" value={work} onChange={setWork} placeholder="e.g. Cyber Hub" />
          </>
        )}

        {step === 2 && <PreferenceFields value={prefs} onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))} />}

        <div className="rr-actions">
          {step > 0 && <button className="rr-btn" onClick={() => setStep(step - 1)}>Back</button>}
          {last ? (
            <button className="rr-btn primary" onClick={finish}>Finish</button>
          ) : (
            <button className="rr-btn primary" onClick={() => setStep(step + 1)}>Next</button>
          )}
          <button className="rr-btn quiet" onClick={skip}>Skip setup</button>
        </div>
      </div>
    </div>
  );
}

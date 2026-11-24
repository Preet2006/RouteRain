import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PlaceField } from '@/components/PlaceField';
import { PreferenceFields } from '@/components/PreferenceFields';
import { MAX_NAME_LENGTH } from '@/lib/storage';
import { useProfile } from '@/lib/useProfile';

/** Every profile field is editable here and saved as you change it. */
export function Settings() {
  const { profile, store, persistent } = useProfile();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rr-text">
      <h1>Settings</h1>
      <p className={persistent ? 'rr-muted' : 'rr-note'} role={persistent ? undefined : 'status'}>
        {persistent
          ? 'Your name, saved places and preferences are kept on this device only. Nothing is sent to an account.'
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
            value={profile.name}
            onChange={(e) => store.update({ name: e.target.value })}
          />
        </div>
        <PlaceField label="Home" value={profile.home} onChange={(home) => store.update({ home })} />
        <PlaceField label="Work" value={profile.work} onChange={(work) => store.update({ work })} />
      </section>

      <section className="rr-card" aria-labelledby="s-pref">
        <h2 id="s-pref">Preferences</h2>
        <PreferenceFields value={profile} onChange={(patch) => store.update(patch)} />
      </section>

      <section className="rr-card rr-span-all" aria-labelledby="s-data">
        <h2 id="s-data">Your data</h2>
        {profile.recentTrips.length > 0 && (
          <p className="rr-muted">{profile.recentTrips.length} recent trip{profile.recentTrips.length === 1 ? '' : 's'} saved on this device.</p>
        )}
        {!confirming ? (
          <button className="rr-btn" onClick={() => setConfirming(true)}>Clear my data</button>
        ) : (
          <div role="alertdialog" aria-label="Confirm clearing your data" className="rr-confirm">
            <p>This removes your name, saved places and preferences from this device. You will see the welcome page again.</p>
            <div className="rr-actions">
              <button
                className="rr-btn danger"
                onClick={() => {
                  store.clear();
                  navigate('/', { replace: true }); // back to the entry screen
                }}>
                Yes, clear everything
              </button>
              <button className="rr-btn" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
      </div>
      <p className="rr-caveat-line">A guide, not a guarantee.</p>
    </div>
  );
}

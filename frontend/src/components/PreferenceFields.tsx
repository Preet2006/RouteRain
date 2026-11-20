import { useState } from 'react';

import { TEST_VOICE_LINE, useHasHindi } from '@/lib/useHasHindi';
import { speech } from '@/lib/speech';
import type { Profile } from '@/lib/storage';

type Prefs = Pick<Profile, 'voiceOn' | 'language' | 'caution'>;

/** Voice on/off, voice language and caution level. Used by Setup (step 3) and Settings. */
export function PreferenceFields({ value, onChange }: { value: Prefs; onChange: (patch: Partial<Prefs>) => void }) {
  const hasHindi = useHasHindi();
  const [speaking, setSpeaking] = useState(false);
  const [testNote, setTestNote] = useState('');
  const hindiBlocked = hasHindi === false;
  // A saved Hindi choice on a device without a Hindi voice cannot be spoken: speak English instead.
  const effectiveLanguage = value.language === 'hi' && hindiBlocked ? 'en' : value.language;

  async function testVoice() {
    setTestNote('');
    if (!speech.isSupported()) {
      setTestNote("This browser can't speak. Use Chrome or Edge for voice advice.");
      return;
    }
    setSpeaking(true);
    const ok = await speech.speak(TEST_VOICE_LINE[effectiveLanguage], effectiveLanguage);
    setSpeaking(false);
    if (!ok) setTestNote('The voice could not play. Check the volume and that the tab is not muted.');
  }

  return (
    <>
      <fieldset className="rr-fieldset">
        <legend>Voice advice</legend>
        <label className="rr-check">
          <input type="checkbox" checked={value.voiceOn} onChange={(e) => onChange({ voiceOn: e.target.checked })} />
          Read my route advice aloud
        </label>
        <div role="radiogroup" aria-label="Voice language" className="rr-radios">
          <label className="rr-check">
            <input type="radio" name="voice-language" checked={value.language === 'en'} onChange={() => onChange({ language: 'en' })} />
            English
          </label>
          <label className="rr-check">
            <input
              type="radio"
              name="voice-language"
              checked={value.language === 'hi'}
              disabled={hindiBlocked}
              onChange={() => onChange({ language: 'hi' })}
            />
            हिन्दी (Hindi)
          </label>
        </div>
        {hindiBlocked && (
          <p className="rr-note" role="note">
            Hindi is switched off because this browser or device has no Hindi voice. Advice will be read in English.
            Chrome on Windows can add one under Settings → Time &amp; language → Speech.
          </p>
        )}
        {hasHindi === undefined && <p className="rr-muted">Checking available voices…</p>}
        <button type="button" className="rr-btn" onClick={testVoice} disabled={speaking}>
          {speaking ? 'Speaking…' : 'Test voice'}
        </button>
        {testNote && <p className="rr-field-error" role="alert">{testNote}</p>}
      </fieldset>

      <fieldset className="rr-fieldset">
        <legend>How cautious?</legend>
        <label className="rr-check rr-choice">
          <input type="radio" name="caution" checked={value.caution === 'cautious'} onChange={() => onChange({ caution: 'cautious' })} />
          <span><b>Cautious</b><small>Avoid RED and YELLOW hotspots.</small></span>
        </label>
        <label className="rr-check rr-choice">
          <input type="radio" name="caution" checked={value.caution === 'balanced'} onChange={() => onChange({ caution: 'balanced' })} />
          <span><b>Balanced</b><small>Avoid RED only; YELLOW is allowed.</small></span>
        </label>
      </fieldset>
    </>
  );
}

import { useNavigate } from 'react-router-dom';

import { useProfile } from '@/lib/useProfile';

/** Placeholder: the real 3-step setup (name, home/work, voice and caution) is built in phase W4. */
export function Setup() {
  const { store } = useProfile();
  const navigate = useNavigate();
  return (
    <div className="rr-hero">
      <div>
        <h1>Quick setup</h1>
        <p>Name, saved places and preferences arrive in the next phase. You can skip this for now.</p>
        <button
          className="rr-btn primary"
          onClick={() => {
            store.update({ onboarded: true });
            navigate('/');
          }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

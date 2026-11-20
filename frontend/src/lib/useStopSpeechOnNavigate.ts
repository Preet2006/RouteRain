import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { speech } from './speech';

/** Cancels any speech when the page changes, and when the tab is closed or reloaded. */
export function useStopSpeechOnNavigate() {
  const location = useLocation();
  useEffect(() => {
    speech.stop();
  }, [location.pathname]);
  useEffect(() => {
    const stop = () => speech.stop();
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, []);
}

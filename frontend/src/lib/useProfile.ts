import { useSyncExternalStore } from 'react';

import { profileStore } from './storage';

/** The saved profile as React state; re-renders on any change. */
export function useProfile() {
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.get, profileStore.get);
  return { profile, store: profileStore, persistent: profileStore.isPersistent() };
}

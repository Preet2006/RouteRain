import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { initApiBaseUrl } from '@/api/baseUrl';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Load the (optional) runtime server-address override before the first request.
    initApiBaseUrl().finally(() => {
      setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </QueryClientProvider>
  );
}

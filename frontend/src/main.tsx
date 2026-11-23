import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { SplashGate } from './components/Splash';
import { ScenarioProvider } from './lib/scenario';
import './styles/base.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScenarioProvider>
          <SplashGate>
            <App />
          </SplashGate>
        </ScenarioProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

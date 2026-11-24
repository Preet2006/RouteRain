import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { App } from './App';
import { ScenarioProvider } from './lib/scenario';
import './styles/base.css';

// A data router (instead of <BrowserRouter>) so pages can warn before leaving with unsaved changes.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ScenarioProvider>
        <App />
      </ScenarioProvider>
    ),
  },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

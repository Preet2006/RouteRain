import { configure } from '@testing-library/dom';

// The suite runs many jsdom files in parallel; the default 1 s wait for async UI is too tight on a busy laptop.
configure({ asyncUtilTimeout: 4000 });

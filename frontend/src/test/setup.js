import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom does not implement scrolling; the Dashboard scrolls to the top when a trip loads.
window.scrollTo = () => {};

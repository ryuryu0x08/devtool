import { defineConfig } from '@playwright/test';
import { BUILT } from './built';

// The desktop app itself, built by `npm run pack`: what the browser doesn't have (its origin,
// links, a second launch, storage between launches). The toolbox's own tests in the app:
// `npm run test:e2e:desktop -w @devtool/toolbox`.
process.env.TOOLBOX_APP ??= BUILT;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
});

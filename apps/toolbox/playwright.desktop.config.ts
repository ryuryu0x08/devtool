import { defineConfig } from '@playwright/test';
import { BUILT } from './desktop/built';

// The same end-to-end tests, in the desktop app (desktop/, Electron) instead of the browser:
// `npm run test:e2e:desktop` after `npm run pack -w @devtool/toolbox-desktop`. Each test launches
// the app with storage of its own (e2e/helpers.ts). One at a time: the launches share the
// system's clipboard and focus.
process.env.TOOLBOX_APP ??= BUILT;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  // As the browser's tests have them (playwright.config.ts); e2e/helpers.ts gives them to the app.
  use: { locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 900 } },
});

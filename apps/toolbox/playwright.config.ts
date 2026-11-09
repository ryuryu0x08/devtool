import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the production build: `npm run test:e2e`
// (first time on a new machine: `npx playwright install chromium`).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4317',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1280, height: 900 },
    // Scrollbars that take room, as on Windows and Linux (Playwright hides them by default).
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4317 --strictPort',
    port: 4317,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

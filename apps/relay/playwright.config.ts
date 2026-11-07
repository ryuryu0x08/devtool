import { defineConfig, devices } from '@playwright/test';

// The window in Chromium against a stand-in for the app's commands (e2e/fake.ts):
// `npm run test:e2e -w @devtool/relay`. The real app is tested by ci/app_e2e.sh.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4318',
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1200, height: 820 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 820 } } }],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4318 --strictPort',
    port: 4318,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

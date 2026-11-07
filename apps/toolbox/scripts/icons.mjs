// Renders public/apple-touch-icon.png from public/favicon.svg: `node scripts/icons.mjs`.
// Square and full-bleed: iOS rounds the corners itself.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/favicon.svg', 'utf8').replace(' rx="7"/>', '/>');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 }, colorScheme: 'light' });
await page.setContent(`<style>body{margin:0}svg{display:block;width:180px;height:180px}</style>${svg}`);
await page.screenshot({ path: 'public/apple-touch-icon.png' });
await browser.close();

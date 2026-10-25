import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'browser.spec.mjs', workers: 1, timeout: 20000, reporter: 'list', use: { screenshot: 'only-on-failure' } });

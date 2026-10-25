const path = require('node:path');
const frontend = path.resolve(__dirname, '../../../frontend');
const { defineConfig } = require(require.resolve('@playwright/test', { paths: [frontend] }));

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: ['workspace.spec.cjs', 'native-autocomplete.spec.cjs'],
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/prompt-enhance-extension-qa',
  use: { headless: true, trace: 'retain-on-failure', actionTimeout: 7000 },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
  ],
});

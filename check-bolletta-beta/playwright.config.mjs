export default {
  testDir: './tests',
  testMatch: /.*browser\.e2e\.spec\.mjs/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
  },
};

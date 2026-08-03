import { defineConfig, devices } from '@playwright/test';

const e2eStatePath=`tmp/monitor/e2e-${process.pid}.json`;
const backendEnv={
  YNX_MONITOR_DEV_USERS:'1',
  YNX_MONITOR_SESSION_SECRET:'s'.repeat(32),
  YNX_MONITOR_STATE_INTEGRITY_KEY:'i'.repeat(32),
  YNX_MONITOR_STATE_PATH:e2eStatePath,
  YNX_MONITOR_ALLOWED_ORIGINS:'http://127.0.0.1:24674',
  YNX_MONITOR_PORT:'24675',
};

export default defineConfig({
  testDir:'./tests',
  timeout:90_000,
  workers:1,
  expect:{timeout:15_000},
  fullyParallel:false,
  use:{
    baseURL:'http://127.0.0.1:24674',
    trace:'retain-on-failure',
  },
  webServer:[
    {
      command:'node node_modules/tsx/dist/cli.mjs server/index.ts',
      url:'http://127.0.0.1:24675/health',
      reuseExistingServer:false,
      timeout:30_000,
      env:backendEnv,
    },
    {
      command:'node node_modules/vite/bin/vite.js --config vite.e2e.config.ts',
      url:'http://127.0.0.1:24674',
      reuseExistingServer:false,
      timeout:30_000,
    },
  ],
  projects:[
    {
      name:'desktop',
      use:{
        ...devices['Desktop Chrome'],
        channel:'chrome',
        viewport:{width:1440,height:1000},
      },
    },
    {
      name:'mobile',
      use:{
        ...devices['iPhone 13'],
        browserName:'chromium',
        channel:'chrome',
      },
    },
  ],
});

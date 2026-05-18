import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      PORT: '4001',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://quill:quill@localhost:5432/quill_test',
      JWT_ACCESS_SECRET: 'unit-test-access-secret-must-be-32-bytes!',
      JWT_REFRESH_SECRET: 'unit-test-refresh-secret-must-be-32-bytes!',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_dummy_test_secret',
      STRIPE_PRICE_READER: 'price_reader_test',
      STRIPE_PRICE_PATRON: 'price_patron_test',
      ASSET_BUCKET: 'quill-test',
      ASSET_REGION: 'us-east-1',
      ASSET_SIGN_SECRET: 'unit-test-asset-sign-secret-32-bytes!',
      ASSET_PUBLIC_BASE_URL: 'https://assets.test',
    },
  },
});

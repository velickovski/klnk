module.exports = {
  rootDir: '../../..',
  preset: 'jest-expo',
  testMatch: ['<rootDir>/apps/mobile/component-test/**/*.component.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/apps/mobile/component-test/setup.ts'],
  moduleNameMapper: {
    '^@personal-agent/domain$': '<rootDir>/packages/domain/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  maxWorkers: 2,
  modulePathIgnorePatterns: ['<rootDir>/.data/', '<rootDir>/docs/', '<rootDir>/apps/mobile/dist'],
  testTimeout: 10_000,
  clearMocks: true,
};

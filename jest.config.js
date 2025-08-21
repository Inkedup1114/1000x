/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/app/ts/__tests__', '<rootDir>/tests/property'],
  testMatch: ['**/__tests__/**/*.test.js', '**/property/**/*.test.js'],
  collectCoverageFrom: [
    'app/ts/**/*.ts',
    '!app/ts/__tests__/**',
    '!app/ts/**/*.test.ts',
    '!tests/property/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  verbose: true,
};
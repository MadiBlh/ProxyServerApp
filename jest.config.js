/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '**/src/**/*.test.ts',
    '**/tests/**/*.test.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/types/**',
    '!**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          module: 'CommonJS',
          target: 'ES2020'
        }
      }
    ]
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};

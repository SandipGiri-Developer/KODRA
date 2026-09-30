/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/__mocks__/vscode.js',
    '^sharp$': '<rootDir>/src/utils/mockSharp.js',
  },
};

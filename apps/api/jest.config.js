module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  roots: ['<rootDir>', '<rootDir>/../scripts'],
  testRegex: '.*\.spec\.ts$',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
};

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
};

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 30000,
  // 测试库隔离：setupFiles 在加载被测模块前改写 MYSQL_DATABASE，globalSetup 确保测试库存在。
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup-e2e.ts',
  moduleNameMapper: {
    '^@record-replay/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};

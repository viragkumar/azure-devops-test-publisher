const path = require("path");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  rootDir: path.resolve(__dirname, ".."),
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "\\.real\\.test\\.ts$"],
  transform: {
    "^.+\\.[tj]sx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
};

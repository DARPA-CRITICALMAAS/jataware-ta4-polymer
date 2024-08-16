
const config = {
  verbose: true,
  notify: true,
  // globals: {
  // },
  testEnvironment: "jsdom",

  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["js", "jsx", "tsx", "ts"],
  extensionsToTreatAsEsm: ['.ts'],

  transform: {
    "^.+\\.ts?$": [
      "ts-jest",
      {
        useESM: true,
        isolatedModules: true,
        diagnostics: {
          exclude: ["**"],
        },
      },
    ],
  }
};

export default config;

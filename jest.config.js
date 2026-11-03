module.exports = {
  preset: '@react-native/jest-preset',
  // satellite.js ships an ESM-only exports map (no "require" condition),
  // so jest-resolve cannot resolve the bare specifier. Map it to the dist
  // file directly; the transformIgnorePatterns allowlist pushes it through
  // babel-jest.
  moduleNameMapper: {
    '^satellite\\.js$': '<rootDir>/node_modules/satellite.js/dist/index.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|satellite\\.js)/)',
  ],
};

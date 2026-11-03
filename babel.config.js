module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // satellite.js (ESM) uses `export * as ns from ...` in its dist entry,
    // which @react-native/babel-preset cannot transform under jest.
    // No-op for app code that does not use the syntax.
    '@babel/plugin-transform-export-namespace-from',
  ],
};

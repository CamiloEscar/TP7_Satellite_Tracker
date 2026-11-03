const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // satellite.js 7.1.0 re-exports its optional WASM builds from the ESM
    // entry; their package-internal specifiers ('#wasm-single-thread' /
    // '#wasm-multi-thread') resolve at bundle time into emscripten modules
    // that import 'node:*', which Metro cannot resolve. The WASM build is
    // explicitly out of scope for this app (Hito 9 performance ceiling,
    // requires Hermes WASM support), so stub it with an empty module. The
    // dynamic imports are never executed by the JS code path we use.
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName === '#wasm-single-thread' ||
        moduleName === '#wasm-multi-thread'
      ) {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

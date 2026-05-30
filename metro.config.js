// metro.config.js
// CRITICAL: tflite files must be in assetExts so models bundle correctly
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Add tflite and bin to asset extensions
    assetExts: [
      ...defaultConfig.resolver.assetExts,
      'tflite',   // TensorFlow Lite models
      'bin',      // Binary model weights
      'db',       // SQLite (dev only)
    ],
    sourceExts: [
      ...defaultConfig.resolver.sourceExts,
      'ts',
      'tsx',
    ],
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true, // Faster startup
      },
    }),
  },
};

module.exports = mergeConfig(defaultConfig, config);

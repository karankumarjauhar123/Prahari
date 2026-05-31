// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],
        extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
        alias: {
          '@': './src',
          '@services': './src/services',
          '@screens': './src/screens',
          '@components': './src/components',
          '@hooks': './src/hooks',
          '@utils': './src/utils',
          '@constants': './src/constants/index',
        },
      },
    ],
    'react-native-worklets-core/plugin',
    'react-native-reanimated/plugin', // Reanimated plugin MUST be last
  ],
};

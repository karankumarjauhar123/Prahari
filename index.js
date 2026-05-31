// index.js
// IMPORTANT: react-native-get-random-values MUST be imported before uuid
// to provide crypto.getRandomValues() polyfill for React Native
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

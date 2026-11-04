/**
 * @format
 */

import { AppRegistry } from 'react-native';
import BackgroundFetch from 'react-native-background-fetch';
import App from './App';
import { name as appName } from './app.json';
import { backgroundFetchHeadlessTask } from './src/bootstrap';

// background-fetch README: register the headless task at the app entry
// point, outside any component (handles fetch events after app termination).
BackgroundFetch.registerHeadlessTask(backgroundFetchHeadlessTask);

AppRegistry.registerComponent(appName, () => App);

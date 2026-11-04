import { NavigationContainer } from '@react-navigation/native';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createDataProvider } from './src/bootstrap';
import { DataProviderContext } from './src/dataProviderContext';
import AppNavigator from './src/navigation/AppNavigator';

// Composition root: the real data layer is wired once here and injected into
// screens through DataProviderContext (tests mock src/bootstrap).
const dataProvider = createDataProvider();

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <DataProviderContext.Provider value={dataProvider}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </DataProviderContext.Provider>
  );
}

export default App;

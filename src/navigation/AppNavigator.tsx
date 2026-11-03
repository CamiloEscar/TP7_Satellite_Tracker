import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import CatalogScreen from '../screens/CatalogScreen';
import HomeScreen from '../screens/HomeScreen';
import MapScreen from '../screens/MapScreen';
import PassesScreen from '../screens/PassesScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ValidationScreen from '../screens/ValidationScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Satellite Tracker' }}
      />
      <Stack.Screen
        name="Mapa"
        component={MapScreen}
        options={{ title: 'Mapa' }}
      />
      <Stack.Screen
        name="Catalogo"
        component={CatalogScreen}
        options={{ title: 'Catálogo' }}
      />
      <Stack.Screen
        name="Pases"
        component={PassesScreen}
        options={{ title: 'Pases' }}
      />
      <Stack.Screen
        name="Validacion"
        component={ValidationScreen}
        options={{ title: 'Validación' }}
      />
      <Stack.Screen
        name="Configuracion"
        component={SettingsScreen}
        options={{ title: 'Configuración' }}
      />
    </Stack.Navigator>
  );
}

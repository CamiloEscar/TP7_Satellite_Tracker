import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';

export type HomeScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Home'
>;

type MenuEntry = {
  key: Exclude<keyof RootStackParamList, 'Home' | 'CatalogDetail'>;
  title: string;
};

const MENU: MenuEntry[] = [
  { key: 'Mapa', title: 'Mapa' },
  { key: 'Catalogo', title: 'Catálogo' },
  { key: 'Pases', title: 'Pases' },
  { key: 'Validacion', title: 'Validación' },
  { key: 'Configuracion', title: 'Configuración' },
];

export default function HomeScreen({ navigation }: HomeScreenProps) {
  return (
    <FlatList
      data={MENU}
      keyExtractor={item => item.key}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          onPress={() => navigation.navigate(item.key)}
        >
          <Text style={styles.itemTitle}>{item.title}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  item: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCCCCC',
  },
  itemPressed: {
    backgroundColor: '#EEEEEE',
  },
  itemTitle: {
    fontSize: 17,
    color: '#000000',
  },
});

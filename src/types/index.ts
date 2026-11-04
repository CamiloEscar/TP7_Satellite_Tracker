export type RootStackParamList = {
  Home: undefined;
  Mapa: { noradId?: number } | undefined;
  Catalogo: undefined;
  CatalogDetail: { noradId: number; name: string };
  Pases: undefined;
  Validacion: undefined;
  Configuracion: undefined;
};

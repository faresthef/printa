import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.si7r.printa',
  appName: 'Printa',
  webDir: 'dist',
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Recherche…',
        cancel: 'Annuler',
        availableDevices: 'Imprimantes trouvées',
        noDeviceFound: 'Aucune imprimante trouvée',
      },
    },
  },
};

export default config;

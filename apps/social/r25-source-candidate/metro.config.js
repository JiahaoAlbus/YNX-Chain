const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const expoResolveRequest = config.resolver.resolveRequest;
const applicationEntry = path.join(__dirname, 'index.ts');

// Linked packages must share the application's React Native runtime. Resolving
// a peer from its external real path otherwise installs a second AppRegistry:
// Expo registers the root in one instance while Native starts the other.
// Keep Expo's normal resolver and package exports, changing only the lookup
// origin for React Native itself and its supported subpaths.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = moduleName === 'react-native' || moduleName.startsWith('react-native/')
    ? {...context, originModulePath: applicationEntry}
    : context;
  return expoResolveRequest
    ? expoResolveRequest(origin, moduleName, platform)
    : context.resolveRequest(origin, moduleName, platform);
};

module.exports = config;

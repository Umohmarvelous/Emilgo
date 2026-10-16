const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// games/ holds web games with their own toolchain (Vite + three.js). The app
// embeds their BUILT output (src/games/**), never their sources, so Metro must
// not crawl them or their node_modules.
const existingBlock = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlock) ? existingBlock : existingBlock ? [existingBlock] : []),
  /[\\/]games[\\/][^\\/]+[\\/](node_modules|dist|dist-emilgo|src|scripts)[\\/].*/,
];

const WEB_ALIASES = {
  "react-native-maps": "@teovilla/react-native-web-maps",
};

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && WEB_ALIASES[moduleName]) {
    return context.resolveRequest(context, WEB_ALIASES[moduleName], platform);
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

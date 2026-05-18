// Metro config.
//
// The voice-loop LiteRT engine is a *vendored* package
// (vendor/react-native-litert-lm, symlinked into node_modules via a
// `file:` dependency). Its `react-native-nitro-modules` import is a peer
// dependency. npm's peer auto-install can drop an incomplete second copy
// into the vendored package's own node_modules, and Metro — resolving the
// symlinked package from its real path — binds to that nested copy
// instead of walking up to the project's top-level one. Result:
// "ENOENT … react-native-nitro-modules/src/index.ts" at bundle time and
// a native/JS Nitro version split (0.35.4 vs 0.35.6).
//
// Fix: force the single hoisted copy of the shared singleton-ish native
// deps for every importer (including the vendored package), and watch
// the vendor/ tree so its sources are part of the graph.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const pin = (pkg) => path.resolve(projectRoot, "node_modules", pkg);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "react-native-nitro-modules": pin("react-native-nitro-modules"),
  react: pin("react"),
  "react-native": pin("react-native"),
};

config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(projectRoot, "vendor"),
];

module.exports = config;

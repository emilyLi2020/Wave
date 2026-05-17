const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
console.log("Type of blockList:", typeof config.resolver.blockList);
console.log("Is Array?", Array.isArray(config.resolver.blockList));
console.log("Value:", config.resolver.blockList);

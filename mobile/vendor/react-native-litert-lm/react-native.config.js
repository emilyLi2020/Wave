module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "./android",
        packageImportPath: "import dev.litert.litertlm.LiteRTLMPackage;",
        packageInstance: "new LiteRTLMPackage()",
        componentDescriptors: [],
        cmakeListsPath: "CMakeLists.txt",
      },
      ios: {
        podspecPath: "./react-native-litert-lm.podspec",
      },
    },
  },
};

@AGENTS.md

## Deploying to a physical device

Before deploying the app to a phone, read **`./deploy.md`**. It covers
the custom-library traps that break most deploys: the vendored
`react-native-litert-lm` (`file:` symlink + committed codegen), the
`react-native-nitro-modules` nested-`node_modules` Metro failure and the
`metro.config.js` fix, patch-package'd `react-native-sherpa-onnx`, which
dev-client build to install (non-AEC half-duplex vs AEC full-duplex),
`devicectl` + Metro restart/reload gotchas, the earpiece audio-routing
pitfall, and a symptom → fix cheat-sheet.

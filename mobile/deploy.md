# Deploy to a physical iPhone — quick guide

The pain is the **custom native libraries**, not Expo. Read the "Custom
library gotchas" section first; most failed deploys are one of those.

## TL;DR

```bash
cd mobile
npm install                       # runs postinstall → patch-package (REQUIRED)
npx eas build --profile development --platform ios   # dev client, ~7-40 min
# when FINISHED: grab the .ipa URL and install on the connected iPhone:
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun devicectl list devices                          # find the device id
curl -sL -o /tmp/wave.ipa "<applicationArchiveUrl from eas build:list>"
xcrun devicectl device install app --device <DEVICE_ID> /tmp/wave.ipa
npx expo start -c --port 8081     # Metro; the dev client loads JS from here
# open the app on the phone → it pulls JS from Metro
```

Device used this project: `D0ECA348-E755-51C0-9291-082EF5A917EA`
(`Bills iphone 17 pro`). `eas build:list --platform ios --limit 5 --json`
gives `artifacts.applicationArchiveUrl` for each finished build.

It is a **dev client**: JS comes from Metro at runtime. Only **native**
changes (anything under `ios/`, a new native dep, a `patches/` change)
need a new EAS build. JS-only changes just need a **reload**.

## Custom library gotchas (this is where deploys fail)

### 1. `react-native-litert-lm` is VENDORED (`file:` dep) — needs codegen

`package.json`: `"react-native-litert-lm": "file:vendor/react-native-litert-lm"`.
`node_modules/react-native-litert-lm` is a **symlink** → `../vendor/...`.
The vendored copy must contain its built `lib/` + `nitrogen/generated/`
(committed, .gitignore de-fanged) or `pod install` / the Nitro
autolink fails in the EAS build. Don't `rm -rf` the vendor dir.

### 2. The nitro-modules nested-node_modules trap (most common Metro break)

Symptom: Metro error `ENOENT … vendor/react-native-litert-lm/node_modules/react-native-nitro-modules/src/index.ts`, or "no such module … nitro modules", or a `0.35.4 vs 0.35.6` Nitro version-mismatch warning.

Cause: `npm install` (esp. installing any new dep) can drop an
**incomplete nested `react-native-nitro-modules`** into the vendored
package's own `node_modules` (peer auto-install). Metro resolves the
symlinked package from its real path and binds to that broken nested
copy instead of the good top-level one.

Fix (already in repo, don't remove):
- `metro.config.js` pins `react-native-nitro-modules` / `react` /
  `react-native` to the single top-level copy via
  `resolver.extraNodeModules`, and adds `vendor/` to `watchFolders`.
- If it still happens: `rm -rf vendor/react-native-litert-lm/node_modules`
  (it's gitignored, npm-created junk), then restart Metro with `-c`.

### 3. `react-native-sherpa-onnx` is patch-packaged

`patches/react-native-sherpa-onnx+0.4.3.patch` is applied by the
`postinstall: patch-package` script. **Always `npm install` (not a
manual node_modules copy)** so the patch applies; EAS runs it in the
cloud build automatically. The patch adds iOS voice-processing/AEC + a
PlayAndRecord session — only relevant to the **AEC build** (see below).

### 4. Which build to install

- **Half-duplex demo (default, audible):** use the **non-AEC** dev
  client — a build from a commit **before** the patch-package/AEC work
  (e.g. `1c14a59`). Stock sherpa → plain `Playback` → loud speaker.
- **Full-duplex barge-in:** needs the **AEC build** (commit `51af883`+,
  has the sherpa patch). Its VoiceChat/VPIO session is heavier and
  routes audio differently — only use it if you actually need talk-over.

Both load the same branch JS from Metro; only native audio differs.

## Metro gotchas

- **Restart after native dep / cache weirdness:** `npx expo start -c`
  (clears cache). The numeric "Requiring unknown module N" error =
  stale Metro after files changed — full reload or `-c` restart.
- **Kill Metro by PID, not pattern.** The process cmdline is
  `expo start -c --port 8081`; `pkill -f "expo start --port 8081"`
  does NOT match it (the `-c`). Use `pgrep -fl "expo start"` → `kill -9
  <pid>` and confirm it's gone, or you'll keep serving a stale graph.
- **JS change → Reload, not app-restart.** Closing/reopening the app
  can reuse the cached bundle. Use the dev-menu **Reload** (shake), or
  reconnect to the Metro URL. Verify via on-screen labels, not output.

## Audio routing pitfall (cost us hours)

Do **not** call `setAudioModeAsync({ allowsRecording: true })` while TTS
is playing. expo-audio maps it to `playAndRecord` with **no
`defaultToSpeaker`** (it has no speaker flag) → iOS routes output to the
**earpiece** → "TTS generated, player OK, but silent". Let sherpa's
`startPcmPlayer` own the session during playback.

## Symptom → fix cheat-sheet

| Symptom | Cause | Fix |
|---|---|---|
| Metro `ENOENT …nitro-modules/src/index.ts` / "no such module" | nested nitro junk in vendor/ | `rm -rf vendor/react-native-litert-lm/node_modules`; `expo start -c`; metro.config.js must exist |
| `Requiring unknown module "1600"` | stale Metro graph | full Reload, else `expo start -c` |
| App crashes at launch (dyld / Nitro HybridObject) | EAS build missing vendored codegen, or stale build | rebuild via EAS (don't hand-copy node_modules) |
| TTS generates (logs show chunks) but no sound | earpiece routing | don't `setAudioModeAsync({allowsRecording:true})` during playback; use non-AEC build for half-duplex |
| Changes not showing despite reopen | cached bundle | dev-menu Reload; check Metro reachable from phone (same Wi-Fi / correct host) |
| `xcrun devicectl` not found | DEVELOPER_DIR unset | `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` |
| `eas build:run` hangs | it's interactive | download the `.ipa` + `devicectl device install` instead |

## Build concurrency

Other agents share this repo/machine. Before any local `xcodebuild`,
`pgrep xcodebuild` first. EAS builds are cloud (no contention) — prefer
them. Never blanket-`pkill xcodebuild`.

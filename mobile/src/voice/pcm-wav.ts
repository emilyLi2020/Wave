// Float32 PCM → 16-bit mono WAV file.
//
// Review pass 1 (#5, issue #21): the proven Whisper path is a WAV file URI
// into whisper.rn (that's what the push-to-talk MVP and WhisperTestScreen
// used via expo-audio's recorder). The VAD endpointer hands us raw Float32
// PCM instead of a recording, so we serialize it to the same WAV shape
// whisper.rn already ingests rather than betting on a raw-PCM transcribe
// path that isn't validated on device. A raw-PCM spike is an optional
// follow-up; this keeps the loop on the known-good road.

import { Directory, File, Paths } from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Hermes has no global btoa and Buffer isn't reliably polyfilled; encode
// the WAV bytes ourselves.
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

/** Build a canonical 44-byte-header 16-bit PCM mono WAV from Float32 samples. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2; // 16-bit
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = samples[i]!;
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}

let wavSeq = 0;

/**
 * Write the samples to a WAV in the cache dir and return its file:// URI.
 * Whisper reads it, then the next turn overwrites — a tiny bounded set of
 * temp files (no unbounded disk growth).
 */
export async function writePcmToWavFile(
  samples: Float32Array,
  sampleRate: number,
): Promise<string> {
  const dir = new Directory(Paths.cache, "wave-vad");
  dir.create({ intermediates: true, idempotent: true });
  // Alternate between two slots so a slow Whisper read on the previous
  // turn can't be clobbered by the next turn's write.
  const file = new File(dir, `utt-${wavSeq++ % 2}.wav`);
  const b64 = bytesToBase64(encodeWav(samples, sampleRate));
  await writeAsStringAsync(file.uri, b64, { encoding: "base64" });
  return file.uri;
}

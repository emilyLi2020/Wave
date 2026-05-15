# Ambient audio assets

## Bundled: `ocean-waves.mp3`

| | |
|--|--|
| Source | BigSoundBank — [Sea Waves](https://bigsoundbank.com/detail-0266-sea-waves.html) |
| Direct URL | `https://lasonotheque.org/UPLOAD/mp3/0266.mp3` |
| License | **CC0 / public domain** — no attribution required |
| Duration | 57 s (looped indefinitely by the player) |
| Format | MP3, 320 kbps, 44.1 kHz, stereo |
| Size | 2.3 MB |

Re-download with:

```bash
curl -L -o client/public/audio/ocean-waves.mp3 \
  https://lasonotheque.org/UPLOAD/mp3/0266.mp3
```

## How the bed picks a source

The session's ambient bed loads `/audio/ocean-waves.mp3` if present and
falls back to a synthesized pink-noise wave bed otherwise (see
[`client/app/session/_components/ambient-audio-bed.tsx`](../../app/session/_components/ambient-audio-bed.tsx)).
The dev console logs which source is active on every session start.

Drop a public-domain or CC0 ocean-wave recording at:

```
client/public/audio/ocean-waves.mp3
```

The file should be **at least 30 seconds long** (the player loops it
indefinitely), mono or stereo, MP3 or OGG. The web `AudioContext`
decodes both. Keep the file under ~3 MB so cold-load doesn't stall
the session intake.

## Suggested sources

All public-domain (CC0) — no attribution required for redistribution:

- **Wikimedia Commons — Sounds of oceans**
  https://commons.wikimedia.org/wiki/Category:Sounds_of_oceans
  Several CC0 recordings. Look for `.ogg` files; convert to MP3 if you
  want broader cache hit rates.

- **Internet Archive — public domain sound libraries**
  https://archive.org/search?query=subject%3A%22ocean+waves%22+AND+rights%3Apublic+domain
  Filter by "Public Domain" rights. Several long-form recordings.

- **NPS public-domain field recordings** (US National Park Service —
  works produced by federal employees are public domain by default)
  https://www.nps.gov/subjects/sound/sounds-listen.htm

## Conversion

If you have an OGG or WAV file and want to ship MP3:

```bash
ffmpeg -i ocean-waves.ogg -codec:a libmp3lame -qscale:a 4 ocean-waves.mp3
```

`-qscale:a 4` is VBR ~165 kbps — plenty for background loop.

## Privacy note

The ambient bed historically generated every sample on-device (pink
noise + LFO). Loading a real recording from `/audio/` is still
on-origin — the file ships with the build, nothing leaves the device.

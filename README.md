# Trackture

A local, dependency-free browser app for capturing a browser tab's shared audio and exporting it as a ZIP of standard WAV files.

## Run it

Serve this folder from a local web server, then open the shown address in Chrome or Edge:

```bash
python3 -m http.server 8000
```

Visit `http://localhost:8000`, select a browser tab, and enable **Share tab audio** in the browser picker. The interface will show the channels the browser reports. Click **Start recording**, then **Stop**, and download the ZIP.

## What the export contains

- `01-original-mix.wav`: the original captured audio with all available channels
- For a stereo source, the default export also includes `02-stereo-center.wav` (shared left/right content) and `03-stereo-sides.wav` (the left/right difference). These sound materially different while remaining complementary parts of the original stereo mix.
- Choose **Left / right** before recording if you specifically need the raw source channels instead.
- For a dual-mono source, redundant channel files are omitted automatically.

Audio is processed in the browser and downloaded directly; it is never uploaded.

## Important limitation

Web browser capture requires an explicit user selection in the system/browser picker. It generally cannot capture arbitrary device output. Also, center/sides and channel splits are not AI stem separation: vocals, drums, speakers, or instruments that are already mixed into the same channel cannot be recovered as separate tracks without the original multitrack source or a dedicated separation model/service.

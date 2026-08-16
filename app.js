const $ = (selector) => document.querySelector(selector);
const ui = {
  select: $('#selectSource'), record: $('#recordButton'), stop: $('#stopButton'),
  download: $('#downloadButton'), sourceTitle: $('#sourceTitle'), sourceHint: $('#sourceHint'),
  status: $('#statusText'), meter: $('#meterFill'), peak: $('#peakValue'), tracks: $('#trackList'),
  empty: $('#emptyState'), note: $('#trackNote'), count: $('#trackCount'), exportArea: $('#exportArea'),
  exportDetail: $('#exportDetail'), splitButtons: [...document.querySelectorAll('[data-split]')]
};

let stream;
let audioContext;
let analyser;
let meterFrame;
let isRecording = false;
let channelBuffers = [];
let sampleRate = 48000;
let finalTracks = [];
let inputChannels = 0;
let splitMode = 'midside';

function setStatus(text, active = false) {
  ui.status.textContent = text;
  document.querySelector('.status-dot').style.background = active ? '#f07e63' : '#d6fb73';
}

function prettyDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function trackWave(color = 'var(--lime)') {
  const bars = [12, 24, 18, 28, 15, 22, 11, 25, 16, 20, 10, 27];
  return `<span class="track-wave">${bars.map((height) => `<b style="height:${height}px;background:${color}"></b>`).join('')}</span>`;
}

function previewDescriptors(channels) {
  const original = { title: 'Original mix', meta: 'ALL CHANNELS · WAV', color: '#c3d3cc' };
  if (channels < 2) return [original];
  if (channels === 2 && splitMode === 'midside') {
    return [original, { title: 'Stereo center', meta: 'LEFT + RIGHT · WAV' }, { title: 'Stereo sides', meta: 'LEFT − RIGHT · WAV' }];
  }
  if (channels === 2) return [original, { title: 'Left channel', meta: 'DISCRETE CHANNEL · WAV' }, { title: 'Right channel', meta: 'DISCRETE CHANNEL · WAV' }];
  return [original, ...Array.from({ length: channels }, (_, index) => ({ title: `Channel ${index + 1}`, meta: 'DISCRETE CHANNEL · WAV' }))];
}

function renderTracks(descriptors, recording = false) {
  ui.empty.hidden = true;
  ui.tracks.hidden = false;
  ui.note.hidden = false;
  ui.count.textContent = `${descriptors.length} TRACK${descriptors.length === 1 ? '' : 'S'}`;
  ui.tracks.innerHTML = descriptors.map((track, index) => `
    <div class="track">
      ${trackWave(track.color || 'var(--lime)')}
      <div><div class="track-name">${track.title}</div><div class="track-meta">${track.meta}</div></div>
      <span class="track-tag">${recording ? 'REC' : (track.tag || 'READY')}</span>
    </div>`).join('');
}

function setTrackNote(message) {
  ui.note.innerHTML = `<span>i</span>${message}`;
}

function drawMeter() {
  if (!analyser) return;
  const values = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(values);
  let total = 0;
  for (const value of values) {
    const normalized = (value - 128) / 128;
    total += normalized * normalized;
  }
  const rms = Math.sqrt(total / values.length);
  const db = rms ? Math.max(-60, 20 * Math.log10(rms)) : -60;
  ui.meter.style.width = `${Math.max(0, Math.min(100, (db + 60) * 1.67))}%`;
  ui.peak.textContent = db <= -59 ? '−∞ dB' : `${db.toFixed(1)} dB`;
  meterFrame = requestAnimationFrame(drawMeter);
}

async function chooseSource() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert('This browser does not support tab or screen audio capture. Try a current version of Chrome or Edge.');
    return;
  }
  try {
    if (isRecording) stopRecording();
    if (stream) stopSource();
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      alert('No audio was shared. Choose a browser tab in the picker and turn on “Share tab audio,” then try again.');
      return;
    }
    audioTrack.addEventListener('ended', () => { if (!isRecording) stopSource(); });
    audioContext = new AudioContext();
    await audioContext.resume();
    sampleRate = audioContext.sampleRate;
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser); // No destination connection: avoids re-playing audio or creating feedback.
    inputChannels = Math.max(1, Math.min(8, audioTrack.getSettings().channelCount || source.channelCount || 1));
    finalTracks = [];
    renderTracks(previewDescriptors(inputChannels));
    setTrackNote('Center/sides turns a stereo capture into its shared content and its left/right difference. It does not isolate instruments already mixed together.');
    ui.sourceTitle.textContent = 'Source connected';
    ui.sourceHint.textContent = `${inputChannels} available channel${inputChannels === 1 ? '' : 's'} detected · ready to record`;
    ui.record.disabled = false;
    setStatus('Source connected');
    drawMeter();
  } catch (error) {
    if (error.name !== 'NotAllowedError') alert(`Couldn’t start capture: ${error.message}`);
  }
}

async function startRecording() {
  if (!stream || isRecording) return;
  try {
    const source = audioContext.createMediaStreamSource(stream);
    const channelCount = Math.max(1, Math.min(8, source.channelCount || inputChannels));
    inputChannels = channelCount;
    channelBuffers = Array.from({ length: channelCount }, () => []);
    const processor = audioContext.createScriptProcessor(4096, channelCount, channelCount);
    source.connect(processor);
    processor.connect(audioContext.destination);
    processor.onaudioprocess = (event) => {
      if (!isRecording) return;
      for (let index = 0; index < channelCount; index++) {
        channelBuffers[index].push(new Float32Array(event.inputBuffer.getChannelData(Math.min(index, event.inputBuffer.numberOfChannels - 1))));
      }
    };
    stream._tracktureProcessor = processor;
    stream._tracktureSource = source;
    isRecording = true;
    finalTracks = [];
    ui.exportArea.hidden = true;
    ui.record.disabled = true;
    ui.record.classList.add('is-recording');
    ui.record.innerHTML = '<span></span>Recording';
    ui.stop.disabled = false;
    ui.splitButtons.forEach((button) => { button.disabled = true; });
    renderTracks(previewDescriptors(channelCount), true);
    setStatus('Recording', true);
    ui.sourceHint.textContent = `Capturing ${channelCount} channel${channelCount === 1 ? '' : 's'} locally`;
  } catch (error) {
    alert(`Couldn’t start recording: ${error.message}`);
  }
}

function mergeBuffers(buffers) {
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  buffers.forEach((buffer) => { result.set(buffer, offset); offset += buffer.length; });
  return result;
}

function channelDifference(left, right) {
  let energy = 0;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    energy += left[index] ** 2 + right[index] ** 2;
    difference += (left[index] - right[index]) ** 2;
  }
  return energy < 0.000001 ? 0 : Math.sqrt(difference / energy);
}

function createMidSide(left, right) {
  const center = new Float32Array(left.length);
  const sides = new Float32Array(left.length);
  for (let index = 0; index < left.length; index++) {
    center[index] = (left[index] + right[index]) * 0.5;
    sides[index] = (left[index] - right[index]) * 0.5;
  }
  return { center, sides };
}

function toWav(channels) {
  const frames = channels[0].length;
  const bytes = 44 + frames * channels.length * 2;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, bytes - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, frames * channels.length * 2, true);
  let offset = 44;
  for (let index = 0; index < frames; index++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, channel[index] || 0));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function createExport(channels) {
  const mix = { name: '01-original-mix.wav', data: toWav(channels) };
  const descriptors = [{ title: 'Original mix', meta: 'ALL CHANNELS · WAV', color: '#c3d3cc' }];
  if (channels.length === 1) return { files: [mix], descriptors, note: 'This source is mono, so only one meaningful audio track is available.' };
  if (channels.length === 2) {
    const difference = channelDifference(channels[0], channels[1]);
    if (difference < 0.012) return {
      files: [mix], descriptors,
      note: 'Dual-mono input detected: left and right were effectively identical, so redundant channel exports were removed.'
    };
    if (splitMode === 'midside') {
      const { center, sides } = createMidSide(channels[0], channels[1]);
      return {
        files: [mix, { name: '02-stereo-center.wav', data: toWav([center]) }, { name: '03-stereo-sides.wav', data: toWav([sides]) }],
        descriptors: [...descriptors, { title: 'Stereo center', meta: 'LEFT + RIGHT · WAV' }, { title: 'Stereo sides', meta: 'LEFT − RIGHT · WAV' }],
        note: `Stereo difference detected (${Math.round(difference * 100)}%). Center and sides are complementary components of the stereo mix—not instrument stems.`
      };
    }
    return {
      files: [mix, { name: '02-left-channel.wav', data: toWav([channels[0]]) }, { name: '03-right-channel.wav', data: toWav([channels[1]]) }],
      descriptors: [...descriptors, { title: 'Left channel', meta: 'DISCRETE CHANNEL · WAV' }, { title: 'Right channel', meta: 'DISCRETE CHANNEL · WAV' }],
      note: `Stereo difference detected (${Math.round(difference * 100)}%). These are raw left/right channels, not instrument stems.`
    };
  }
  const files = [mix, ...channels.map((channel, index) => ({ name: `${String(index + 2).padStart(2, '0')}-channel-${index + 1}.wav`, data: toWav([channel]) }))];
  return { files, descriptors: [...descriptors, ...channels.map((_, index) => ({ title: `Channel ${index + 1}`, meta: 'DISCRETE CHANNEL · WAV' }))], note: 'Each source channel has been kept as its own WAV file.' };
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
  const u16 = (value) => new Uint8Array([value & 255, value >>> 8 & 255]);
  const u32 = (value) => new Uint8Array([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]);
  files.forEach(({ name, data }) => {
    const filename = encoder.encode(name); const crc = crc32(data);
    const local = [u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), filename, data];
    chunks.push(...local);
    central.push([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), filename]);
    offset += local.reduce((sum, part) => sum + part.length, 0);
  });
  const centralBytes = central.flat();
  const centralLength = centralBytes.reduce((sum, part) => sum + part.length, 0);
  return new Blob([...chunks, ...centralBytes, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralLength), u32(offset), u16(0)], { type: 'application/zip' });
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  stream._tracktureProcessor.disconnect();
  stream._tracktureSource.disconnect();
  const merged = channelBuffers.map(mergeBuffers);
  const result = createExport(merged);
  finalTracks = result.files;
  ui.stop.disabled = true;
  ui.record.classList.remove('is-recording');
  ui.record.innerHTML = '<span></span>Start recording';
  ui.record.disabled = false;
  ui.splitButtons.forEach((button) => { button.disabled = false; });
  renderTracks(result.descriptors);
  setTrackNote(result.note);
  ui.exportArea.hidden = false;
  ui.exportDetail.textContent = `${finalTracks.length} WAV file${finalTracks.length === 1 ? '' : 's'} · ${prettyDuration(merged[0].length / sampleRate)} recorded · ${sampleRate / 1000} kHz`;
  setStatus('Recording ready to export');
}

function stopSource() {
  cancelAnimationFrame(meterFrame);
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  if (audioContext) audioContext.close();
  audioContext = null; analyser = null;
  ui.meter.style.width = '0%'; ui.peak.textContent = '−∞ dB'; ui.record.disabled = true;
}

function downloadArchive() {
  if (!finalTracks.length) return;
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(zip(finalTracks)), download: `trackture-${new Date().toISOString().slice(0, 10)}.zip` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

ui.select.addEventListener('click', chooseSource);
ui.record.addEventListener('click', startRecording);
ui.stop.addEventListener('click', stopRecording);
ui.download.addEventListener('click', downloadArchive);
ui.splitButtons.forEach((button) => button.addEventListener('click', () => {
  if (isRecording || finalTracks.length) return;
  splitMode = button.dataset.split;
  ui.splitButtons.forEach((item) => item.classList.toggle('active', item === button));
  if (inputChannels) renderTracks(previewDescriptors(inputChannels));
}));

const dialog = $('#infoDialog');
$('#howItWorks').addEventListener('click', () => dialog.showModal());
dialog.querySelectorAll('.close-dialog,.dialog-action').forEach((button) => button.addEventListener('click', () => dialog.close()));

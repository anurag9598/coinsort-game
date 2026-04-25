/**
 * AudioEngine.js  — React Native safe (no Web Audio API)
 * Uses expo-av Sound with pre-encoded minimal WAV data URIs.
 * WAV buffers are built using proper chunked base64 to avoid
 * call stack overflow from spread operator on large arrays.
 */
import { Audio } from 'expo-av';

// ─── Audio mode setup ─────────────────────────────────────────
Audio.setAudioModeAsync({
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
}).catch(() => {});

// ─── Safe base64 encoder (no spread on large arrays) ──────────
function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let result = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(result);
}

// ─── WAV generator ────────────────────────────────────────────
function buildWAV(freq, durationSec, volume = 0.3, wave = 'sine') {
  const SR       = 22050;
  const nSamples = Math.floor(SR * durationSec);
  const buf      = new ArrayBuffer(44 + nSamples * 2);
  const view     = new DataView(buf);

  const str = (off, s) =>
    [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));

  str(0,  'RIFF');
  view.setUint32(4,  36 + nSamples * 2, true);
  str(8,  'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16,    true);
  view.setUint16(20, 1,     true);   // PCM
  view.setUint16(22, 1,     true);   // mono
  view.setUint32(24, SR,    true);
  view.setUint32(28, SR * 2,true);
  view.setUint16(32, 2,     true);
  view.setUint16(34, 16,    true);
  str(36, 'data');
  view.setUint32(40, nSamples * 2, true);

  const attack = Math.floor(SR * 0.012);
  const release = Math.floor(SR * 0.08);

  for (let i = 0; i < nSamples; i++) {
    const t = i / SR;
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > nSamples - release) env = (nSamples - i) / release;

    let s = 0;
    if (wave === 'sine')     s = Math.sin(2 * Math.PI * freq * t);
    else if (wave === 'tri') s = 2 * Math.abs(2 * (t * freq % 1) - 1) - 1;
    else                     s = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.5;

    view.setInt16(44 + i * 2, s * env * volume * 32767, true);
  }

  return new Uint8Array(buf);
}

// ─── Play a tone safely ───────────────────────────────────────
let _muted = false;

async function playTone(freq, dur, wave = 'sine', vol = 0.28, delayMs = 0) {
  if (_muted) return;
  try {
    await new Promise(r => setTimeout(r, delayMs));
    const wav  = buildWAV(freq, dur, vol, wave);
    const b64  = uint8ToBase64(wav);
    const uri  = `data:audio/wav;base64,${b64}`;
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { volume: vol * 1.4, shouldPlay: true }
    );
    sound.setOnPlaybackStatusUpdate(status => {
      if (status.didJustFinish) sound.unloadAsync().catch(() => {});
    });
  } catch (_) {}
}

// ─── Background music state ───────────────────────────────────
let _bgTimer = null;
let _bgPlaying = false;
let _bgIdx = 0;

const BG_BARS = [
  { ch: [130.81, 196, 261.63], mel: [523.25, 659.25, 783.99, 659.25] },
  { ch: [174.61, 220,  349.23], mel: [698.46, 880,    1046.5, 880   ] },
  { ch: [196,    246.94,392  ], mel: [783.99, 987.77, 1174.6, 987.77] },
  { ch: [130.81, 164.81,196  ], mel: [659.25, 783.99, 1046.5, 783.99] },
];

function playBar() {
  if (!_bgPlaying) return;
  const BPM  = 108;
  const BEAT = 60000 / BPM;
  const bar  = BG_BARS[_bgIdx % BG_BARS.length];
  _bgIdx++;

  // Pad chords — quiet triangle waves
  bar.ch.forEach(f => playTone(f, (BEAT * 4) / 1000, 'tri', 0.055));

  // Bass on beats 1 & 3
  [0, 2].forEach(b =>
    playTone(bar.ch[0] / 2, 0.32, 'tri', 0.10, b * BEAT)
  );

  // Melody arpeggio
  bar.mel.forEach((f, i) =>
    playTone(f, 0.24, 'sine', 0.08, i * BEAT)
  );

  _bgTimer = setTimeout(playBar, BEAT * 4);
}

// ─── Public API ───────────────────────────────────────────────
export const audioEngine = {
  startBg() {
    if (_bgPlaying) return;
    _bgPlaying = true;
    playBar();
  },

  stopBg() {
    _bgPlaying = false;
    clearTimeout(_bgTimer);
    _bgTimer = null;
  },

  setMuted(m) {
    _muted = m;
    if (m) this.stopBg();
  },

  // SFX
  pick()   { playTone(880,  0.07, 'sine', 0.18); playTone(1320, 0.05, 'sine', 0.10, 20); },
  drop()   { playTone(660,  0.10, 'sine', 0.22); playTone(990,  0.07, 'tri',  0.11, 30); },
  bad()    { playTone(200,  0.12, 'sqr',  0.15); playTone(160,  0.09, 'sqr',  0.11, 60); },
  deal()   { [440, 550, 660, 550, 440].forEach((f,i) => playTone(f, 0.12, 'sine', 0.16, i*65)); },

  sort() {
    [523, 659, 784, 1047].forEach((f, i) => playTone(f, 0.28, 'sine', 0.26, i * 90));
    setTimeout(() => playTone(2093, 0.40, 'sine', 0.16), 430);
  },

  levelUp() {
    [261, 329, 392, 523, 659, 784, 1047]
      .forEach((f, i) => playTone(f, 0.35, 'tri', 0.26, i * 100));
    setTimeout(() =>
      [523, 659, 784, 1047, 1319]
        .forEach((f, i) => playTone(f, 0.45, 'sine', 0.20, i * 90))
    , 1200);
  },

  win() {
    [261, 329, 392, 523, 659, 784, 1047, 1319, 1568]
      .forEach((f, i) => playTone(f, 0.50, 'sine', 0.28, i * 80));
  },
};

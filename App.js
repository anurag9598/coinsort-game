/**
 * COIN SORT PUZZLE  — Single-file production build
 * All components, logic, audio, and styles are self-contained.
 * No imports from ./src — safe for EAS cloud build.
 *
 * Architecture (Senior Game Dev Design):
 * ─────────────────────────────────────
 * STATE MODEL:
 *   racks[i] = null          → locked slot
 *   racks[i] = []            → empty unlocked buffer
 *   racks[i] = [d,d,d...]    → coins bottom→top (top = last elem)
 *
 * SELECTION MODEL:
 *   selected = []             → idle
 *   selected = [rIdx]         → 1 coin lifted
 *   selected = [rIdx, rIdx2]  → 2 same-denom coins lifted (multi-select)
 *
 * DEAL = smart shuffle + inject helper coins (does NOT open racks)
 * LEVEL = new rack unlocks + new denominations progressively
 */

import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, SafeAreaView, Animated, StatusBar,
  Dimensions, ScrollView, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

const { width: SW } = Dimensions.get('window');

/* ═══════════════════════════════════════════════════════════════
   1. CONSTANTS & COIN PALETTE
═══════════════════════════════════════════════════════════════ */
const CAP         = 4;    // coins per rack needed to complete
const TOTAL_SLOTS = 10;   // 2 rows × 5 cols
const MAX_LEVEL   = 10;

// Coin visual palette
// s=shine  a=highlight  b=mid  c=deep  e=edge  g=glow  n=name
const COIN = {
  1:  { s:'#ffd0a0', a:'#d87030', b:'#a83818', c:'#601808', e:'#882210', g:'#ff8030', n:'Copper'   },
  2:  { s:'#f0f8ff', a:'#b8d4e8', b:'#6888a8', c:'#304860', e:'#406070', g:'#70b8f0', n:'Silver'   },
  3:  { s:'#ffffa0', a:'#f0d020', b:'#c89008', c:'#805800', e:'#a07000', g:'#ffd020', n:'Gold'     },
  4:  { s:'#b0ff90', a:'#48d030', b:'#108810', c:'#084808', e:'#0c6810', g:'#28d010', n:'Jade'     },
  5:  { s:'#b0c8ff', a:'#5880f0', b:'#0840d0', c:'#062890', e:'#0638b8', g:'#2868f8', n:'Sapphire' },
  6:  { s:'#e0b0ff', a:'#b858f0', b:'#6808c8', c:'#400880', e:'#5010a0', g:'#9030e8', n:'Amethyst' },
  7:  { s:'#ffb0b0', a:'#e83838', b:'#b00808', c:'#700808', e:'#980808', g:'#ee1818', n:'Ruby'     },
  8:  { s:'#ffb8d0', a:'#e85878', b:'#c01048', c:'#800028', e:'#a00838', g:'#ee3868', n:'Rose'     },
  9:  { s:'#c0f8ff', a:'#28d0e8', b:'#0890b0', c:'#045068', e:'#066078', g:'#08c8f0', n:'Crystal'  },
  10: { s:'#fff0a0', a:'#f8b820', b:'#d07000', c:'#804000', e:'#a85800', g:'#ffa010', n:'Topaz'    },
};

const LVL_NAMES  = ['NOVICE','APPRENTICE','JOURNEYMAN','EXPERT','VETERAN',
                    'MASTER','LEGEND','GRANDMASTER','CHAMPION','SOVEREIGN'];
const LVL_COLORS = ['#4e8ec8','#30a858','#c89000','#d05810','#c82020',
                    '#7018c0','#c01868','#086888','#b85000','#806000'];
const LVL_ICONS  = ['🌱','⭐','🌟','💫','🔥','💎','👑','🌊','🦅','🏆'];

/* ═══════════════════════════════════════════════════════════════
   2. LEVEL PROGRESSION CONFIG
   Rule: numTypes = level + 1 (capped at 10)
         activeRacks = numTypes + 2   (always 2 empty buffers)
         dealBonus = new helper coins injected per deal
═══════════════════════════════════════════════════════════════ */
function getLevelCfg(lvl) {
  const numTypes   = Math.min(lvl + 1, 10);
  const active     = Math.min(numTypes + 2, TOTAL_SLOTS);
  const locked     = TOTAL_SLOTS - active;
  const dealBonus  = 2 + Math.floor(lvl / 4);
  const startDeals = Math.max(2, 5 - Math.floor(lvl / 3));
  return { numTypes, active, locked, dealBonus, startDeals };
}

/* ═══════════════════════════════════════════════════════════════
   3. PURE GAME LOGIC
═══════════════════════════════════════════════════════════════ */

/** Fisher-Yates shuffle — returns new array */
const shuffle = (arr) => {
  const r = [...arr];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

const rackTop   = (r) => (Array.isArray(r) && r.length > 0) ? r[r.length - 1] : null;
const rackDone  = (r) => Array.isArray(r) && r.length === CAP && r.every(c => c === r[0]);
const canDrop1  = (r, d) => Array.isArray(r) && r.length < CAP     && (r.length === 0 || rackTop(r) === d);
const canDrop2  = (r, d) => Array.isArray(r) && r.length + 1 < CAP && (r.length === 0 || rackTop(r) === d);

/** Check if board has at least one valid move */
function hasMoves(racks) {
  const active = racks.filter(r => Array.isArray(r));
  if (active.some(r => r.length === 0)) return true;
  for (const src of active) {
    const top = rackTop(src);
    if (top === null) continue;
    for (const dst of active) {
      if (dst !== src && canDrop1(dst, top)) return true;
    }
  }
  return false;
}

/**
 * Build a fresh shuffled board for a given level.
 * Guarantees at least one valid move from the start.
 */
function makeLevel(lvl) {
  const { numTypes, locked } = getLevelCfg(lvl);

  // Pool: numTypes × CAP coins
  const pool = shuffle(
    Array.from({ length: numTypes }, (_, i) => i + 1)
      .flatMap(d => Array(CAP).fill(d))
  );

  // Fill numTypes racks + 2 empty buffers
  const filled = Array.from({ length: numTypes }, (_, r) =>
    [...pool.slice(r * CAP, (r + 1) * CAP)]
  );
  const racks = [
    ...Array(locked).fill(null),
    ...filled,
    [], [],
  ];

  // Safety: if no moves, force a path by swapping a coin to empty rack
  if (!hasMoves(racks)) {
    const activeIdx = racks
      .map((r, i) => (Array.isArray(r) && r.length > 0 ? i : -1))
      .filter(i => i >= 0);
    const emptyIdx = racks.findIndex(r => Array.isArray(r) && r.length === 0);
    if (activeIdx.length > 0 && emptyIdx >= 0) {
      racks[emptyIdx].push(racks[activeIdx[0]].pop());
    }
  }
  return racks;
}

/**
 * SMART DEAL ALGORITHM
 * ────────────────────
 * Step 1: Drain all non-completing active racks into pool
 * Step 2: Frequency analysis → find denom closest to completing
 * Step 3: Inject dealBonus helper coins of that denom
 * Step 4: Smart redistribute with partial grouping
 * Step 5: Guarantee ≥1 empty rack + ≥1 valid move
 *
 * INVARIANT: total coin count never decreases (only increases by dealBonus)
 */
function smartDeal(racks, lvl, completing) {
  const { dealBonus } = getLevelCfg(lvl);
  const next = racks.map(r => (Array.isArray(r) ? [...r] : r));

  // Step 1: Collect all coins from non-completing active racks
  let pool = [];
  next.forEach((r, i) => {
    if (Array.isArray(r) && !completing.has(i)) {
      pool.push(...r);
      next[i] = [];
    }
  });

  // Step 2: Frequency analysis
  const freq = {};
  pool.forEach(d => { freq[d] = (freq[d] || 0) + 1; });

  // Find denom with gap closest to completing (most helpful injection)
  const needy = Object.entries(freq)
    .map(([d, c]) => ({ d: +d, c, gap: CAP - (c % CAP || CAP) }))
    .filter(x => x.gap > 0 && x.gap < CAP)
    .sort((a, b) => a.gap - b.gap);

  // Step 3: Inject helper coins
  for (let i = 0; i < dealBonus; i++) {
    if (needy.length > 0) {
      const target = needy[i % needy.length];
      pool.push(target.d);
      freq[target.d] = (freq[target.d] || 0) + 1;
    } else {
      // Fallback: add most common coin
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (top) { pool.push(+top[0]); }
    }
  }

  // Step 4: Smart redistribute
  // Group by denom, interleave to spread same coins across racks
  const groups = {};
  pool.forEach(d => { (groups[d] = groups[d] || []).push(d); });
  const interleaved = [];
  const keys = shuffle(Object.keys(groups));
  const maxLen = Math.max(...keys.map(k => groups[k].length));
  for (let i = 0; i < maxLen; i++) {
    keys.forEach(k => { if (groups[k][i] !== undefined) interleaved.push(groups[k][i]); });
  }
  // Mild re-shuffle to avoid too-obvious patterns
  const finalPool = shuffle(interleaved);

  // Distribute into active racks keeping ≥2 empty
  const activeIdx = next.map((r, i) => (Array.isArray(r) ? i : -1)).filter(i => i >= 0);
  const keepEmpty = Math.max(2, Math.floor(activeIdx.length * 0.25));
  const fillSlots = activeIdx.slice(0, activeIdx.length - keepEmpty);

  let pi = 0;
  fillSlots.forEach((ri, ii) => {
    const share = Math.floor(finalPool.length / fillSlots.length);
    const extra = ii < finalPool.length % fillSlots.length ? 1 : 0;
    const count = Math.min(share + extra, CAP);
    next[ri] = finalPool.slice(pi, pi + count);
    pi += count;
  });

  // Overflow: spread remaining into partially-filled racks
  while (pi < finalPool.length) {
    const partial = activeIdx.find(ri => next[ri].length < CAP);
    if (partial === undefined) break;
    next[partial].push(finalPool[pi++]);
  }

  // Step 5: Solvability guarantee
  if (!hasMoves(next)) {
    const biggest = activeIdx
      .filter(ri => next[ri].length > 0)
      .sort((a, b) => next[b].length - next[a].length)[0];
    const empty = activeIdx.find(ri => next[ri].length === 0);
    if (biggest !== undefined && empty !== undefined) {
      next[empty].push(next[biggest].pop());
    }
  }

  return next;
}

/* ═══════════════════════════════════════════════════════════════
   4. AUDIO ENGINE  (React Native safe — no Web Audio API)
═══════════════════════════════════════════════════════════════ */

/** Build a WAV buffer without spread-on-large-array (stack safe) */
function buildWAV(freq, durSec, vol = 0.28, wave = 'sine') {
  const SR       = 16000;
  const nSamples = Math.floor(SR * durSec);
  const buf      = new ArrayBuffer(44 + nSamples * 2);
  const dv       = new DataView(buf);
  const str = (off, s) => [...s].forEach((c, i) => dv.setUint8(off + i, c.charCodeAt(0)));

  str(0, 'RIFF'); dv.setUint32(4, 36 + nSamples * 2, true);
  str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, nSamples * 2, true);

  const atk = Math.floor(SR * 0.015);
  const rel = Math.floor(SR * 0.10);

  for (let i = 0; i < nSamples; i++) {
    const t   = i / SR;
    const env = i < atk ? i / atk : i > nSamples - rel ? (nSamples - i) / rel : 1;
    const s   = wave === 'sine'
      ? Math.sin(2 * Math.PI * freq * t)
      : wave === 'tri'
      ? 2 * Math.abs(2 * ((t * freq) % 1) - 1) - 1
      : Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.4;
    dv.setInt16(44 + i * 2, s * env * vol * 32767, true);
  }
  return new Uint8Array(buf);
}

/** Safe base64 encoder — chunked to avoid call stack overflow */
function toBase64(u8) {
  const CHUNK = 8192;
  let out = '';
  for (let i = 0; i < u8.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

let _muted     = false;
let _bgTimer   = null;
let _bgPlaying = false;
let _bgIdx     = 0;

Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false })
  .catch(() => {});

async function playTone(freq, dur, wave = 'sine', vol = 0.26, delayMs = 0) {
  if (_muted) return;
  try {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    const wav  = buildWAV(freq, dur, vol, wave);
    const b64  = toBase64(wav);
    const uri  = `data:audio/wav;base64,${b64}`;
    const { sound } = await Audio.Sound.createAsync(
      { uri }, { volume: Math.min(vol * 1.5, 1), shouldPlay: true }
    );
    sound.setOnPlaybackStatusUpdate(s => {
      if (s.didJustFinish) sound.unloadAsync().catch(() => {});
    });
  } catch (_) {}
}

const BG_BARS = [
  { ch: [130.81, 196, 261.63],  mel: [523.25, 659.25, 783.99, 659.25] },
  { ch: [174.61, 220, 349.23],  mel: [698.46, 880,    1046.5, 880   ] },
  { ch: [196,    246.94, 392],  mel: [783.99, 987.77, 1174.6, 987.77] },
  { ch: [130.81, 164.81, 196],  mel: [659.25, 783.99, 1046.5, 783.99] },
];

function playBgBar() {
  if (!_bgPlaying) return;
  const BPM  = 108;
  const BEAT = 60000 / BPM;
  const bar  = BG_BARS[_bgIdx % BG_BARS.length];
  _bgIdx++;
  bar.ch.forEach(f  => playTone(f,        (BEAT * 4) / 1000, 'tri',  0.045));
  [0, 2].forEach(b  => playTone(bar.ch[0] / 2, 0.32,         'tri',  0.09,  b * BEAT));
  bar.mel.forEach((f, i) => playTone(f,   0.24,              'sine', 0.07,  i * BEAT));
  _bgTimer = setTimeout(playBgBar, BEAT * 4);
}

const SFX = {
  startBg() { if (_bgPlaying) return; _bgPlaying = true; playBgBar(); },
  stopBg()  { _bgPlaying = false; clearTimeout(_bgTimer); _bgTimer = null; },
  setMuted(m) { _muted = m; if (m) this.stopBg(); },
  pick()    { playTone(880,  0.07, 'sine', 0.16); playTone(1320, 0.05, 'sine', 0.09, 20); },
  pick2()   { playTone(880,  0.07, 'sine', 0.16); playTone(1320, 0.06, 'sine', 0.10, 18); playTone(1760, 0.08, 'sine', 0.11, 50); },
  drop()    { playTone(660,  0.10, 'sine', 0.20); playTone(990,  0.07, 'tri',  0.10, 30); },
  bad()     { playTone(200,  0.12, 'sqr',  0.14); playTone(160,  0.09, 'sqr',  0.10, 60); },
  deal()    { [440,550,660,550,440].forEach((f, i) => playTone(f, 0.12, 'sine', 0.15, i * 65)); },
  sort()    { [523,659,784,1047].forEach((f, i) => playTone(f, 0.28, 'sine', 0.24, i * 90));
              setTimeout(() => playTone(2093, 0.4, 'sine', 0.15), 440); },
  levelUp() { [261,329,392,523,659,784,1047].forEach((f, i) => playTone(f, 0.35, 'tri', 0.24, i * 100));
              setTimeout(() => [523,659,784,1047,1319].forEach((f, i) => playTone(f, 0.45, 'sine', 0.18, i * 90)), 1200); },
  win()     { [261,329,392,523,659,784,1047,1319,1568].forEach((f, i) => playTone(f, 0.5, 'sine', 0.26, i * 80)); },
};

/* ═══════════════════════════════════════════════════════════════
   5. COIN COMPONENT  (pure SVG-free, RN View-based rendering)
═══════════════════════════════════════════════════════════════ */
function CoinView({ denom, size = 44, glow = false, style }) {
  const c   = COIN[denom];
  const R   = size / 2;
  const gls = glow ? {
    shadowColor:   c.g,
    shadowOpacity: 0.85,
    shadowRadius:  size * 0.28,
    shadowOffset:  { width: 0, height: 0 },
    elevation:     12,
  } : {
    shadowColor:   '#000',
    shadowOpacity: 0.45,
    shadowRadius:  size * 0.12,
    shadowOffset:  { width: 0, height: size * 0.05 },
    elevation:     6,
  };

  return (
    <View style={[{
      width: size, height: size, borderRadius: R,
      backgroundColor: c.b,
      borderWidth: size * 0.045,
      borderColor: c.e,
      alignItems: 'center', justifyContent: 'center',
      ...gls,
    }, style]}>
      {/* Inner metallic face */}
      <LinearGradient
        colors={[c.s, c.a, c.b, c.c]}
        start={{ x: 0.32, y: 0.20 }}
        end={{ x: 0.85, y: 0.90 }}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          borderRadius: R - size * 0.04,
        }}
      />
      {/* Inner ring */}
      <View style={{
        position: 'absolute',
        width: size * 0.78, height: size * 0.78,
        borderRadius: size * 0.39,
        borderWidth: 1, borderColor: c.s + '60',
      }} />
      {/* Shine spot */}
      <View style={{
        position: 'absolute',
        top: '12%', left: '14%',
        width: '30%', height: '55%',
        backgroundColor: 'rgba(255,255,255,0.26)',
        borderRadius: size,
        transform: [{ rotate: '-22deg' }],
      }} />
      {/* Denomination badge */}
      <View style={{
        width: size * 0.40, height: size * 0.40,
        borderRadius: size * 0.20,
        backgroundColor: 'rgba(0,0,0,0.52)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 2,
      }}>
        <Text style={{
          color: '#fff',
          fontSize: Math.max(size * 0.20, 10),
          fontWeight: '900',
          includeFontPadding: false,
          lineHeight: size * 0.25,
        }}>
          {denom}
        </Text>
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   6. FLOATING COIN  (selected — larger + animated glow)
═══════════════════════════════════════════════════════════════ */
function FloatingCoin({ denom }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  const translateY = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <CoinView denom={denom} size={58} glow />
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   7. RACK SLOT COMPONENT
═══════════════════════════════════════════════════════════════ */
const RACK_W = Math.min(Math.floor((SW - 32) / 5) - 4, 58);
const RACK_H = 195;

function RackSlot({ rack, idx, selected, completing, validTargets, onTap }) {
  const locked   = rack === null;
  const isSel    = selected.includes(idx);
  const isComp   = completing.has(idx);
  const isValid  = validTargets.has(idx);
  const selCount = selected.filter(i => i === idx).length;
  const display  = locked ? [] : rack.slice(0, rack.length - selCount);
  const topCoin  = (!locked && rack.length > 0) ? rack[rack.length - 1] : null;
  const showFloat = isSel && topCoin !== null;

  // Shake animation
  const shakeX = useRef(new Animated.Value(0)).current;
  // Scale animation for completion
  const scaleV = useRef(new Animated.Value(1)).current;
  // Arrow bounce
  const arrowY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isComp) {
      Animated.sequence([
        Animated.spring(scaleV, { toValue: 1.08, useNativeDriver: true }),
        Animated.spring(scaleV, { toValue: 1.00, useNativeDriver: true }),
      ]).start();
    }
  }, [isComp]);

  useEffect(() => {
    if (isValid) {
      Animated.loop(Animated.sequence([
        Animated.timing(arrowY, { toValue: 7, duration: 340, useNativeDriver: true }),
        Animated.timing(arrowY, { toValue: 0, duration: 340, useNativeDriver: true }),
      ])).start();
    } else {
      arrowY.stopAnimation();
      arrowY.setValue(0);
    }
  }, [isValid]);

  function triggerShake() {
    Animated.sequence([
      Animated.timing(shakeX, { toValue:  8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue:  5, duration: 48, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -5, duration: 48, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue:  0, duration: 40, useNativeDriver: true }),
    ]).start();
    return triggerShake;
  }
  // expose shake via ref is awkward in RN; parent calls onTap and we shake locally
  // onTap returns 'shake' signal to trigger it here
  function handleTap() {
    const result = onTap(idx);
    if (result === 'shake') triggerShake();
  }

  const borderColor = isComp  ? '#28c008'
    : isSel   ? '#2878e0'
    : isValid  ? '#20b420'
    : locked   ? 'rgba(155,172,188,0.68)'
    :            'rgba(255,255,255,0.74)';

  const bg1 = isComp ? '#c0ffaa' : isSel ? '#cce6ff' : isValid ? '#c0ffc4' : '#c4d2e0';
  const bg2 = isComp ? '#84ec58' : isSel ? '#90ccfc' : isValid ? '#78ee80' : '#a4b8c8';

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <Animated.View style={[
        styles.rackOuter,
        {
          transform: [{ translateX: shakeX }, { scale: scaleV }],
          borderColor,
          shadowColor: isComp ? '#28c008' : isSel ? '#2878e0' : '#000',
          shadowOpacity: isComp || isSel ? 0.55 : 0.20,
          shadowRadius:  isComp ? 14 : isSel ? 12 : 5,
          elevation: isSel ? 10 : isComp ? 12 : 4,
        },
      ]}>
        <LinearGradient
          colors={[bg1, bg2]}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Chrome accents */}
        <View style={styles.rackTopHighlight} pointerEvents="none" />
        <View style={styles.rackTopShadow}    pointerEvents="none" />
        <View style={styles.rackGroove}       pointerEvents="none" />
        <View style={styles.rackShadowL}      pointerEvents="none" />
        <View style={styles.rackShadowR}      pointerEvents="none" />

        {/* Lock */}
        {locked && <Text style={styles.lockIcon}>🔒</Text>}

        {/* Coin stack (bottom→top, rendered top→bottom visually) */}
        {!locked && display.length > 0 && (
          <View style={styles.stackWrap}>
            {[...display].reverse().map((d, ci) => (
              <View key={ci} style={{ marginBottom: 3 }}>
                <CoinView denom={d} size={RACK_W - 12} glow={isComp} />
              </View>
            ))}
          </View>
        )}

        {!locked && display.length === 0 && !showFloat && (
          <Text style={styles.emptyHint}>○</Text>
        )}

        {/* ✓ SORTED badge */}
        {isComp && (
          <View style={styles.sortedBadge}>
            <Text style={styles.sortedBadgeTxt}>✓ SORTED</Text>
          </View>
        )}

        {/* Valid drop arrow */}
        {isValid && !isSel && (
          <Animated.Text style={[styles.dropArrow, { transform: [{ translateY: arrowY }] }]}>
            ↓
          </Animated.Text>
        )}

        {/* Floating selected coins above the rack */}
        {showFloat && (
          <View style={styles.floatContainer}>
            {selected
              .filter(si => si === idx)
              .map((_, i) => (
                <FloatingCoin key={i} denom={topCoin} />
              ))}
          </View>
        )}
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

/* ═══════════════════════════════════════════════════════════════
   8. LEVEL BANNER  (full-screen overlay)
═══════════════════════════════════════════════════════════════ */
function LevelBanner({ level, onDismiss }) {
  const { numTypes } = getLevelCfg(level);
  const color = LVL_COLORS[(level - 1) % 10];
  const icon  = LVL_ICONS[(level - 1) % 10];
  const name  = LVL_NAMES[(level - 1) % 10];
  const scaleA = useRef(new Animated.Value(0.6)).current;
  const fadeA  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleA, { toValue: 1, tension: 80, friction: 9, useNativeDriver: true }),
      Animated.timing(fadeA,  { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <Modal transparent animationType="none" visible>
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.bannerOverlay}>
          <Animated.View style={[styles.bannerCard, { opacity: fadeA, transform: [{ scale: scaleA }] }]}>
            <Text style={styles.bannerIcon}>{icon}</Text>
            <Text style={[styles.bannerSub,   { color }]}>LEVEL {level} / {MAX_LEVEL}</Text>
            <Text style={[styles.bannerTitle, { textShadowColor: color }]}>{name}</Text>
            <Text style={styles.bannerDesc}>
              Sort <Text style={{ color }}>{numTypes} coin types</Text>
              {'\n'}Stack 4 matching coins → rack clears!
            </Text>
            {/* Coin preview */}
            <View style={styles.bannerCoins}>
              {Array.from({ length: numTypes }, (_, i) => i + 1).map(d => (
                <View key={d} style={{ margin: 4 }}>
                  <CoinView denom={d} size={28} glow />
                </View>
              ))}
            </View>
            <Text style={styles.bannerTap}>tap anywhere to start</Text>
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   9. DEAL INFO MODAL
═══════════════════════════════════════════════════════════════ */
function DealInfoModal({ onClose }) {
  const scaleA = useRef(new Animated.Value(0.78)).current;
  useEffect(() => {
    Animated.spring(scaleA, { toValue: 1, tension: 80, friction: 9, useNativeDriver: true }).start();
  }, []);

  const items = [
    ['🔀', 'Shuffles the board',     'All coins are collected, shuffled, and redistributed. No racks are opened or closed.'],
    ['💉', 'Injects helper coins',   '2–3 new coins are added matching the denomination closest to completing a set of 4.'],
    ['🧠', 'Smart redistribution',   'Coins are interleaved by denomination to create partial groupings and easier moves.'],
    ['⚠️', 'Use wisely',             'Each deal costs 1 token. Earn more by sorting racks. Token count scales with level.'],
  ];

  return (
    <Modal transparent animationType="none" visible>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <Animated.View style={[styles.dealModal, { transform: [{ scale: scaleA }] }]}>
              <Text style={styles.dealModalIcon}>🎲</Text>
              <Text style={styles.dealModalTitle}>Deal Button</Text>
              <Text style={styles.dealModalSub}>Smart shuffle · Injects helper coins</Text>
              {items.map(([ic, t, d]) => (
                <View key={t} style={styles.dealRow}>
                  <Text style={styles.dealRowIcon}>{ic}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dealRowTitle}>{t}</Text>
                    <Text style={styles.dealRowDesc}>{d}</Text>
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.dealCloseBtn} onPress={onClose}>
                <Text style={styles.dealCloseTxt}>Got it! ✓</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   10. WIN SCREEN
═══════════════════════════════════════════════════════════════ */
function WinScreen({ score, moves, onRestart }) {
  const scaleA = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.spring(scaleA, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
  }, []);
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.winOverlay}>
        <Animated.View style={[styles.winCard, { transform: [{ scale: scaleA }] }]}>
          <Text style={styles.winTrophy}>🏆</Text>
          <Text style={styles.winTitle}>YOU WIN!</Text>
          <Text style={styles.winDesc}>All {MAX_LEVEL} levels conquered!</Text>
          <Text style={styles.winScore}>{score}</Text>
          <Text style={styles.winScoreLbl}>FINAL SCORE</Text>
          <Text style={styles.winMoves}>{moves} moves total</Text>
          <TouchableOpacity style={styles.replayBtn} onPress={onRestart} activeOpacity={0.85}>
            <LinearGradient colors={['#ff9800', '#e55100']} style={styles.replayGrad}>
              <Text style={styles.replayTxt}>Play Again 🎮</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   11. MAIN APP
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [racks,      setRacks]    = useState(() => makeLevel(1));
  const [selected,   setSelected] = useState([]);       // array of rack indices
  const [completing, setCompl]    = useState(new Set());
  const [level,      setLevel]    = useState(1);
  const [score,      setScore]    = useState(0);
  const [moves,      setMoves]    = useState(0);
  const [deals,      setDeals]    = useState(() => getLevelCfg(1).startDeals);
  const [sorted,     setSorted]   = useState(0);
  const [toast,      setToast]    = useState(null);
  const [toastKey,   setTK]       = useState(0);
  const [dealAnim,   setDealAnim] = useState(false);
  const [showInfo,   setShowInfo] = useState(false);
  const [showBanner, setBanner]   = useState(false);
  const [muted,      setMuted]    = useState(false);
  const [winShow,    setWin]      = useState(false);

  const toastTmr = useRef(null);
  const cfg      = getLevelCfg(level);
  const nc       = cfg.numTypes;
  const lvlColor = LVL_COLORS[(level - 1) % 10];

  /* ── XP bar animation ── */
  const xpAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pct = (level - 1) / (MAX_LEVEL - 1);
    Animated.spring(xpAnim, { toValue: pct, useNativeDriver: false }).start();
  }, [level]);
  const xpWidth = xpAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  /* ── Compute valid drop targets for current selection ── */
  const validTargets = new Set();
  if (selected.length > 0) {
    const selD = racks[selected[0]] && rackTop(racks[selected[0]]);
    if (selD) {
      const numSel = selected.length; // 1 or 2
      racks.forEach((r, i) => {
        if (!selected.includes(i)) {
          const ok = numSel === 1 ? canDrop1(r, selD) : canDrop2(r, selD);
          if (ok) validTargets.add(i);
        }
      });
    }
  }

  function notify(msg, color = '#fff') {
    clearTimeout(toastTmr.current);
    setToast({ msg, color }); setTK(k => k + 1);
    toastTmr.current = setTimeout(() => setToast(null), 2300);
  }

  /* ══════════════════════════════════════════════════════
     CORE TAP HANDLER — full state machine
  ══════════════════════════════════════════════════════ */
  function tap(idx) {
    const rack = racks[idx];
    if (rack === null || completing.has(idx)) return null;

    /* — A: Nothing selected — pick up top coin — */
    if (selected.length === 0) {
      if (rack.length === 0) return null;
      SFX.pick();
      Haptics.selectionAsync().catch(() => {});
      setSelected([idx]);
      return null;
    }

    const srcIdx = selected[0];
    const selD   = rackTop(racks[srcIdx]);

    /* — B: Tapped already-selected rack — */
    if (selected.includes(idx)) {
      // If 2 selected and tap one source → deselect that one
      if (selected.length === 2) {
        setSelected(selected.filter(i => i !== idx));
      } else {
        setSelected([]);
      }
      return null;
    }

    /* — C: Multi-select upgrade check — */
    // If tapped rack has same top denom → grab it too (multi-select)
    if (selected.length === 1 && rackTop(rack) === selD && rack.length > 0) {
      SFX.pick2();
      Haptics.selectionAsync().catch(() => {});
      setSelected([srcIdx, idx]);
      notify(`✌ 2× ${COIN[selD].n} selected — pick a target!`, COIN[selD].g);
      return null;
    }

    /* — D: Try to drop selected coin(s) onto this rack — */
    const numSel  = selected.length;
    const canPlace = numSel === 1 ? canDrop1(rack, selD) : canDrop2(rack, selD);

    if (!canPlace) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      SFX.bad();
      if (rack.length >= CAP)
        notify('🚫 Rack is full!', '#ff7070');
      else if (rack.length > 0 && rackTop(rack) !== selD)
        notify(`${COIN[rackTop(rack)].n} ≠ ${COIN[selD].n}`, '#ff9060');
      else if (numSel === 2 && rack.length + 2 > CAP)
        notify('Not enough space for 2 coins!', '#ff9060');
      setSelected([]);
      return 'shake';
    }

    /* — EXECUTE VALID MOVE — */
    const nr = racks.map(r => (Array.isArray(r) ? [...r] : r));

    // Validate source racks still have the coins (safety check)
    for (const si of selected) {
      if (!Array.isArray(nr[si]) || rackTop(nr[si]) !== selD) {
        notify('State changed — please re-select', '#ffcc60');
        setSelected([]);
        return null;
      }
    }

    // Pop from each source
    selected.forEach(si => { nr[si].pop(); });
    // Push to destination
    for (let i = 0; i < numSel; i++) nr[idx].push(selD);

    setMoves(m => m + 1);
    SFX.drop();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRacks(nr);
    setSelected([]);

    /* ── Check completion ── */
    if (rackDone(nr[idx])) {
      const bonus = numSel === 2 ? 120 : 60;
      const pts   = selD * 60 + bonus;
      setScore(s => s + pts);
      SFX.sort();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const label = numSel === 2 ? ` (2× COMBO! +${pts})` : ` +${pts}`;
      notify(`🏆 ${COIN[selD].n} sorted!${label}`, COIN[selD].g);

      setCompl(c => { const n = new Set(c); n.add(idx); return n; });

      // Earn deal every 2 completions
      setSorted(prev => {
        const ns = prev + 1;
        if (ns % 2 === 0) setDeals(d => Math.min(d + 1, 6));
        return ns;
      });

      setTimeout(() => {
        setRacks(p => p.map((q, i) => (i === idx ? [] : q)));
        setCompl(p => { const s = new Set(p); s.delete(idx); return s; });

        setSorted(ns => {
          if (ns >= nc) {
            setTimeout(() => {
              if (level >= MAX_LEVEL) {
                SFX.win(); setWin(true); return;
              }
              const nl = level + 1;
              SFX.levelUp();
              setLevel(nl);
              setRacks(makeLevel(nl));
              setSelected([]); setCompl(new Set()); setSorted(0);
              setDeals(getLevelCfg(nl).startDeals);
              setBanner(true);
            }, 700);
          }
          return ns;
        });
      }, 1500);
    }
    return null;
  }

  /* ── DEAL — smart shuffle + inject ── */
  function deal() {
    if (deals <= 0) {
      notify('No deals left! Sort racks to earn more.', '#ff8080');
      return;
    }
    setSelected([]);
    setDealAnim(true);
    SFX.deal();
    notify('🎲 Shuffling + injecting helper coins!', '#ffe566');

    setTimeout(() => {
      setRacks(prev => smartDeal(prev, level, completing));
      setDeals(d => d - 1);
      setDealAnim(false);
    }, 520);
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    SFX.setMuted(m);
  }

  function restart() {
    setLevel(1); setScore(0); setMoves(0); setSorted(0);
    setDeals(getLevelCfg(1).startDeals);
    setRacks(makeLevel(1)); setSelected([]); setCompl(new Set());
    setWin(false); setBanner(false);
    SFX.startBg();
  }

  const row1 = racks.slice(0, 5);
  const row2 = racks.slice(5, 10);
  const lvlIcon = LVL_ICONS[(level - 1) % 10];
  const lvlName = LVL_NAMES[(level - 1) % 10];

  // Status bar message
  let statusMsg = null, statusColor = '#fff';
  if (selected.length === 1) {
    const d = rackTop(racks[selected[0]]);
    statusMsg = d ? `1 × ${COIN[d].n} — tap same coin for 2-select, or drop it!` : null;
    statusColor = d ? COIN[d].g : '#fff';
  } else if (selected.length === 2) {
    const d = rackTop(racks[selected[0]]);
    statusMsg = d ? `✌ 2 × ${COIN[d].n} — pick a target rack!` : null;
    statusColor = d ? COIN[d].g : '#aef';
  } else if (toast) {
    statusMsg  = toast.msg;
    statusColor = toast.color;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#b8c6d4', '#a2b2c2', '#8ea2b2']} style={styles.gameRoot}>

        {/* ── HEADER ── */}
        <View style={styles.header}>
          {/* Level badge */}
          <TouchableOpacity
            style={[styles.levelBadge, { borderColor: lvlColor }]}
            onPress={() => setBanner(true)}
          >
            <Text style={[styles.levelNum, { color: lvlColor }]}>{level}</Text>
            <Text style={styles.levelIcon}>{lvlIcon}</Text>
          </TouchableOpacity>

          {/* XP bar */}
          <View style={styles.xpWrap}>
            <Text style={[styles.xpLabel, { color: lvlColor }]}>
              {lvlName} · {sorted}/{nc} sorted
            </Text>
            <View style={styles.xpBarBg}>
              <Animated.View style={[
                styles.xpBarFill,
                { width: xpWidth, backgroundColor: lvlColor },
              ]} />
            </View>
            <Text style={styles.xpSub}>
              Level {level}/{MAX_LEVEL} · {nc} types · {cfg.active} racks
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.headerControls}>
            <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
              <Text style={styles.controlBtnTxt}>{muted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>
            <View style={styles.scorePill}>
              <Text style={styles.scoreLbl}>PTS</Text>
              <Text style={styles.scoreVal}>{score}</Text>
            </View>
          </View>
        </View>

        {/* ── MOVES + COIN LEGEND ── */}
        <View style={styles.subRow}>
          <Text style={styles.movesText}>Moves: {moves}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.coinLegend}>
            {Array.from({ length: nc }, (_, i) => i + 1).map(d => (
              <View key={d} style={[styles.coinChip, { borderColor: COIN[d].e }]}>
                <View style={[styles.coinChipDot, { backgroundColor: COIN[d].a }]} />
                <Text style={[styles.coinChipTxt, { color: COIN[d].b }]}>{COIN[d].n}</Text>
              </View>
            ))}
          </ScrollView>
          {/* Progress dots */}
          <View style={styles.progRow}>
            {Array.from({ length: nc }).map((_, i) => (
              <View key={i} style={[styles.progDot, {
                backgroundColor: i < sorted ? '#38cc10' : 'rgba(0,0,0,0.18)',
                borderColor:     i < sorted ? '#28aa08' : '#7090a0',
                shadowColor:     '#38cc10',
                shadowOpacity:   i < sorted ? 0.75 : 0,
                shadowRadius:    5,
                elevation:       i < sorted ? 4 : 0,
              }]} />
            ))}
          </View>
        </View>

        {/* ── STATUS BAR ── */}
        <View style={styles.statusBar}>
          {statusMsg ? (
            <View key={toastKey} style={[styles.statusPill, { borderColor: statusColor + '55' }]}>
              <Text style={[styles.statusTxt, { color: statusColor }]}>{statusMsg}</Text>
            </View>
          ) : null}
        </View>

        {/* ── RACK GRID ── */}
        <View style={styles.gridContainer}>
          <LinearGradient
            colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0.06)']}
            style={styles.gridBg}
          >
            {/* Row 1 */}
            <View style={styles.rackRow}>
              {row1.map((rack, ci) => (
                <RackSlot
                  key={ci} rack={rack} idx={ci}
                  selected={selected} completing={completing}
                  validTargets={validTargets} onTap={tap}
                />
              ))}
            </View>
            {/* Row 2 */}
            <View style={[styles.rackRow, { marginTop: 8 }]}>
              {row2.map((rack, ci) => (
                <RackSlot
                  key={5 + ci} rack={rack} idx={5 + ci}
                  selected={selected} completing={completing}
                  validTargets={validTargets} onTap={tap}
                />
              ))}
            </View>
          </LinearGradient>
        </View>

        {/* ── DEAL PIPS ── */}
        <View style={styles.pipRow}>
          <Text style={styles.pipLabel}>Deals:</Text>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={[styles.pip, {
              backgroundColor: i < deals ? '#ffc820' : 'rgba(0,0,0,0.18)',
              borderColor:     i < deals ? '#e09800' : '#7890a0',
              shadowColor:     '#ffc820',
              shadowOpacity:   i < deals ? 0.72 : 0,
              shadowRadius:    4,
              elevation:       i < deals ? 3 : 0,
            }]} />
          ))}
        </View>

        {/* ── DEAL BUTTON ── */}
        <View style={styles.dealRow2}>
          <TouchableOpacity
            onPress={deal}
            disabled={deals <= 0 || dealAnim}
            activeOpacity={0.82}
            style={[styles.dealBtn, { opacity: deals > 0 && !dealAnim ? 1 : 0.48 }]}
          >
            <LinearGradient
              colors={deals > 0 ? ['#3c3830', '#242018'] : ['#505050', '#3a3a3a']}
              style={styles.dealGrad}
            >
              <Text style={styles.dealBtnIcon}>{dealAnim ? '⟳' : '🎲'}</Text>
              <View>
                <Text style={[styles.dealBtnTxt, { color: deals > 0 ? '#44d038' : '#606060' }]}>
                  {dealAnim ? 'Shuffling...' : 'Deal!'}
                </Text>
                <Text style={styles.dealBtnSub}>shuffle + add helper coins</Text>
              </View>
              {deals > 0 && !dealAnim && (
                <View style={styles.dealCount}>
                  <Text style={styles.dealCountTxt}>×{deals}</Text>
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.infoBtn} onPress={() => setShowInfo(true)}>
            <Text style={styles.infoBtnTxt}>?</Text>
          </TouchableOpacity>
        </View>

        {/* ── HINT ── */}
        <View style={styles.hintBox}>
          <Text style={styles.hintTxt}>
            Tap a rack to lift top coin ·{' '}
            <Text style={{ color: '#886600' }}>tap same coin type to grab 2 at once ✌</Text>
            {'\n'}Then drop into any valid rack · 4 matching = clears! 🎊
          </Text>
        </View>

      </LinearGradient>

      {/* ── MODALS ── */}
      {showBanner && <LevelBanner level={level} onDismiss={() => setBanner(false)} />}
      {showInfo   && <DealInfoModal onClose={() => setShowInfo(false)} />}
      {winShow    && <WinScreen score={score} moves={moves} onRestart={restart} />}
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════
   12. STYLES
═══════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  safeArea:   { flex: 1, backgroundColor: '#a8b8c6' },
  gameRoot:   { flex: 1, alignItems: 'center', paddingBottom: 16 },

  // Header
  header:     { width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center',
                gap: 10, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 5 },
  levelBadge: { width: 58, height: 58, borderRadius: 29,
                backgroundColor: 'rgba(0,0,0,0.14)', borderWidth: 2,
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  levelNum:   { fontSize: 22, fontWeight: '900', lineHeight: 26 },
  levelIcon:  { fontSize: 12, lineHeight: 14 },
  xpWrap:     { flex: 1, minWidth: 0 },
  xpLabel:    { fontSize: 10, fontWeight: '900', letterSpacing: 1.5,
                textTransform: 'uppercase', marginBottom: 4 },
  xpBarBg:    { height: 22, borderRadius: 11,
                backgroundColor: 'rgba(0,0,0,0.18)',
                borderWidth: 2, borderColor: 'rgba(255,255,255,0.68)',
                overflow: 'hidden',
                shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3,
                shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  xpBarFill:  { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 9 },
  xpSub:      { fontSize: 9, color: '#4e6070', fontWeight: '700', marginTop: 3, letterSpacing: 0.3 },
  headerControls: { alignItems: 'flex-end', gap: 4 },
  controlBtn: { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 8,
                paddingHorizontal: 8, paddingVertical: 3,
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.32)' },
  controlBtnTxt: { fontSize: 14 },
  scorePill:  { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 9,
                paddingHorizontal: 9, paddingVertical: 3, alignItems: 'center',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  scoreLbl:   { fontSize: 8, color: '#668090', fontWeight: '800', letterSpacing: 1 },
  scoreVal:   { fontSize: 16, fontWeight: '900', color: '#344858' },

  // Sub row
  subRow:     { width: '100%', maxWidth: 420, flexDirection: 'row',
                alignItems: 'center', gap: 7, paddingHorizontal: 12,
                paddingBottom: 2, flexWrap: 'nowrap' },
  movesText:  { fontSize: 10, color: '#506070', fontWeight: '700', flexShrink: 0 },
  coinLegend: { flex: 1 },
  coinChip:   { flexDirection: 'row', alignItems: 'center', gap: 3,
                backgroundColor: 'rgba(0,0,0,0.14)', borderRadius: 10,
                paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1.5,
                marginRight: 4, flexShrink: 0 },
  coinChipDot:{ width: 14, height: 6, borderRadius: 3 },
  coinChipTxt:{ fontSize: 9, fontWeight: '800' },
  progRow:    { flexDirection: 'row', gap: 3, flexShrink: 0 },
  progDot:    { width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5 },

  // Status
  statusBar:  { height: 30, width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  statusPill: { backgroundColor: 'rgba(6,12,24,0.86)', borderRadius: 18,
                paddingHorizontal: 16, paddingVertical: 4,
                borderWidth: 1.5, maxWidth: '100%' },
  statusTxt:  { fontSize: 12, fontWeight: '800' },

  // Grid
  gridContainer: { width: '100%', maxWidth: 420, paddingHorizontal: 8 },
  gridBg:     { borderRadius: 22, paddingHorizontal: 4, paddingTop: 12, paddingBottom: 14 },
  rackRow:    { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  rackOuter:  { width: RACK_W, height: RACK_H, borderRadius: 15,
                borderWidth: 2, overflow: 'visible',
                alignItems: 'center', justifyContent: 'flex-end',
                paddingBottom: 8, position: 'relative' },
  rackTopHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 2.5,
                      backgroundColor: 'rgba(255,255,255,0.82)',
                      borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  rackTopShadow:    { position: 'absolute', top: 0, left: 0, right: 0, height: 18,
                      backgroundColor: 'rgba(0,0,0,0.09)',
                      borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  rackGroove:       { position: 'absolute', left: '50%', marginLeft: -(RACK_W * 0.44),
                      width: RACK_W * 0.88, top: 12, bottom: 0,
                      backgroundColor: 'rgba(0,0,0,0.07)',
                      borderBottomLeftRadius: 9, borderBottomRightRadius: 9 },
  rackShadowL:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 8,
                      backgroundColor: 'rgba(0,0,0,0.06)' },
  rackShadowR:      { position: 'absolute', right: 0, top: 0, bottom: 0, width: 8,
                      backgroundColor: 'rgba(0,0,0,0.06)' },
  lockIcon:   { position: 'absolute', top: '38%', fontSize: 24,
                textShadowColor: 'rgba(0,0,0,0.30)', textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 4 },
  stackWrap:  { alignItems: 'center', position: 'relative', zIndex: 2 },
  emptyHint:  { fontSize: 22, opacity: 0.10, marginBottom: 14 },
  sortedBadge:{ position: 'absolute', top: 8, left: '50%',
                transform: [{ translateX: -30 }],
                backgroundColor: 'rgba(200,255,160,0.60)', borderRadius: 8,
                paddingHorizontal: 5, paddingVertical: 1,
                borderWidth: 1, borderColor: 'rgba(40,180,8,0.4)', zIndex: 5 },
  sortedBadgeTxt: { fontSize: 8, fontWeight: '900', color: '#145a00' },
  dropArrow:  { position: 'absolute', bottom: 7, fontSize: 15, opacity: 0.85 },
  floatContainer: { position: 'absolute', top: -72, flexDirection: 'row', gap: 4,
                    zIndex: 300, alignSelf: 'center' },

  // Deal section
  pipRow:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  pipLabel:   { fontSize: 11, color: '#688090', fontWeight: '700' },
  pip:        { width: 13, height: 13, borderRadius: 6.5, borderWidth: 1.5 },
  dealRow2:   { flexDirection: 'row', alignItems: 'center', gap: 8,
                width: '100%', maxWidth: 420, paddingHorizontal: 16, marginTop: 8 },
  dealBtn:    { flex: 1, borderRadius: 20, overflow: 'hidden',
                shadowColor: '#000', shadowOpacity: 0.40, shadowRadius: 10,
                shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  dealGrad:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 12, paddingVertical: 13, paddingHorizontal: 16 },
  dealBtnIcon:{ fontSize: 26 },
  dealBtnTxt: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  dealBtnSub: { fontSize: 10, color: 'rgba(160,210,140,0.65)', fontWeight: '700', marginTop: 1 },
  dealCount:  { backgroundColor: 'rgba(68,208,52,0.14)',
                borderWidth: 1, borderColor: 'rgba(68,208,52,0.36)',
                borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 },
  dealCountTxt: { fontSize: 12, color: '#88ee80', fontWeight: '800' },
  infoBtn:    { width: 44, height: 44, borderRadius: 22,
                backgroundColor: 'rgba(0,0,0,0.22)',
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
                alignItems: 'center', justifyContent: 'center' },
  infoBtnTxt: { fontSize: 18, fontWeight: '900', color: 'rgba(255,255,255,0.75)' },

  // Hint
  hintBox:    { marginTop: 9, marginHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.10)',
                borderRadius: 13, paddingHorizontal: 14, paddingVertical: 8,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
                maxWidth: 420 - 32 },
  hintTxt:    { fontSize: 11, color: '#4e6070', fontWeight: '700',
                textAlign: 'center', lineHeight: 18 },

  // Level Banner Modal
  bannerOverlay: { flex: 1, backgroundColor: 'rgba(0,6,20,0.92)',
                   alignItems: 'center', justifyContent: 'center' },
  bannerCard: { backgroundColor: 'rgba(10,20,38,0.98)', borderRadius: 28, padding: 30,
                alignItems: 'center', width: SW * 0.88,
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.10)',
                shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 28,
                shadowOffset: { width: 0, height: 12 }, elevation: 20 },
  bannerIcon: { fontSize: 80, marginBottom: 8 },
  bannerSub:  { fontSize: 13, fontWeight: '900', letterSpacing: 5,
                textTransform: 'uppercase', marginBottom: 5 },
  bannerTitle:{ fontSize: 42, fontWeight: '900', color: '#fff', letterSpacing: 3,
                marginBottom: 8, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 28 },
  bannerDesc: { fontSize: 14, color: 'rgba(200,218,240,0.78)', fontWeight: '700',
                textAlign: 'center', marginBottom: 20, lineHeight: 22 },
  bannerCoins:{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 20 },
  bannerTap:  { fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: '700', letterSpacing: 1 },

  // Deal Info Modal
  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,6,20,0.82)',
                 alignItems: 'center', justifyContent: 'center' },
  dealModal:  { backgroundColor: '#192838', borderRadius: 24, padding: 26, width: SW * 0.88,
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
                shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20,
                shadowOffset: { width: 0, height: 8 }, elevation: 16 },
  dealModalIcon:  { fontSize: 40, textAlign: 'center', marginBottom: 6 },
  dealModalTitle: { fontSize: 20, fontWeight: '900', color: '#44d038',
                    textAlign: 'center', marginBottom: 2 },
  dealModalSub:   { fontSize: 11, color: 'rgba(160,190,220,0.6)', fontWeight: '700',
                    textAlign: 'center', marginBottom: 16 },
  dealRow:    { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  dealRowIcon:{ fontSize: 20, lineHeight: 26, flexShrink: 0 },
  dealRowTitle:{ fontSize: 12, fontWeight: '900', color: '#b8d8f0', marginBottom: 2 },
  dealRowDesc:{ fontSize: 11, color: '#607888', fontWeight: '700', lineHeight: 17 },
  dealCloseBtn:{ backgroundColor: '#1060d0', borderRadius: 12, padding: 12,
                 marginTop: 6, alignItems: 'center',
                 borderWidth: 1.5, borderColor: 'rgba(100,180,255,0.38)' },
  dealCloseTxt:{ color: '#fff', fontSize: 15, fontWeight: '900' },

  // Win Screen
  winOverlay: { flex: 1, backgroundColor: 'rgba(0,6,18,0.92)',
                alignItems: 'center', justifyContent: 'center' },
  winCard:    { backgroundColor: '#fffde0', borderRadius: 28, padding: 40,
                alignItems: 'center', width: SW * 0.86,
                shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 28,
                shadowOffset: { width: 0, height: 12 }, elevation: 20 },
  winTrophy:  { fontSize: 70, marginBottom: 8 },
  winTitle:   { fontSize: 34, fontWeight: '900', color: '#2a1000', letterSpacing: 1, marginBottom: 4 },
  winDesc:    { fontSize: 14, color: '#6a3400', fontWeight: '700', marginBottom: 14 },
  winScore:   { fontSize: 46, fontWeight: '900', color: '#b85000' },
  winScoreLbl:{ fontSize: 11, color: '#8a5020', fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
  winMoves:   { fontSize: 13, color: '#8a6040', fontWeight: '700', marginBottom: 24 },
  replayBtn:  { borderRadius: 16, overflow: 'hidden' },
  replayGrad: { paddingHorizontal: 36, paddingVertical: 14 },
  replayTxt:  { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
});

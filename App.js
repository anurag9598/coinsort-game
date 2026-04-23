import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  Animated, StatusBar, Dimensions, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import CoinFace from './src/components/CoinFace';
import RackSlot from './src/components/RackSlot';
import { audioEngine } from './src/audio/AudioEngine';
import {
  CAP, SLOTS, MAX_LVL, STARTING_DEALS, MAX_DEALS, DEALS_PER_SORT,
  LEVEL_NAMES, LEVEL_COLORS, LEVEL_ICONS, COINS, SCORE_PER_SORT,
} from './src/game/constants';
import {
  makeLevel, isRackDone, canDrop, getValidTargets,
  moveCoin, isStuck,
} from './src/game/logic';

const { width: SW } = Dimensions.get('window');

/* ══════════════════════════════════════════════════════════
   SCREENS
══════════════════════════════════════════════════════════ */
type Screen = 'intro' | 'levelBanner' | 'game' | 'win';

/* ══════════════════════════════════════════════════════════
   INTRO SCREEN
══════════════════════════════════════════════════════════ */
function IntroScreen({ onPlay }) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const glowAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 900, delay: 300, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 10, delay: 400, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const glowOpacity = glowAnim.interpolate({ inputRange: [0,1], outputRange: [0.35, 0.85] });

  const decorCoins = [
    { d:1, x:-110, y:-20, rot:-20, sz:54 },
    { d:3, x:-48,  y:-96, rot:12,  sz:68 },
    { d:5, x:52,   y:-96, rot:-7,  sz:68 },
    { d:7, x:112,  y:-20, rot:18,  sz:54 },
    { d:4, x:0,    y:88,  rot:-10, sz:60 },
  ];

  return (
    <LinearGradient colors={['#1a2a40','#060d1a','#0a0418']} style={styles.fullScreen}>
      <StatusBar barStyle="light-content" />

      {/* Decorative coins */}
      <View style={styles.coinOrbit}>
        <Animated.View style={[styles.glowCircle, { opacity: glowOpacity }]} />
        {decorCoins.map((c, i) => (
          <View key={i} style={{
            position:'absolute',
            transform:[{translateX: c.x},{translateY: c.y},{rotate:`${c.rot}deg`}],
          }}>
            <CoinFace denom={c.d} size={c.sz} glow />
          </View>
        ))}
        {/* Center hero coin */}
        <CoinFace denom={3} size={88} glow />
      </View>

      <Animated.View style={[styles.introText, {opacity:fadeAnim,transform:[{translateY:slideAnim}]}]}>
        <Text style={styles.introSubtitle}>PUZZLE GAME</Text>
        <Text style={styles.introTitle}>COIN SORT</Text>
        <Text style={styles.introTagline}>STACK · MATCH · CONQUER</Text>

        {/* Tips row */}
        <View style={styles.tipsRow}>
          {[{e:'👆',t:'Tap to pick'},{e:'🎯',t:'Move to sort'},{e:'✨',t:'Match 4 to clear'}].map((tip,i)=>(
            <View key={i} style={styles.tipBox}>
              <Text style={styles.tipEmoji}>{tip.e}</Text>
              <Text style={styles.tipText}>{tip.t}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.playBtn}
          onPress={()=>{ audioEngine.startBg(); onPlay(); }}
          activeOpacity={0.85}
        >
          <LinearGradient colors={['#f0a000','#ffe040','#f0a000']} style={styles.playBtnGrad}>
            <Text style={styles.playBtnText}>▶  PLAY NOW</Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.musicNote}>🎵 tap to start music</Text>
      </Animated.View>
    </LinearGradient>
  );
}

/* ══════════════════════════════════════════════════════════
   LEVEL BANNER
══════════════════════════════════════════════════════════ */
function LevelBanner({ level, onDismiss }) {
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const nc        = Math.min(level + 1, 8);
  const color     = LEVEL_COLORS[level - 1] || '#5088b8';
  const name      = LEVEL_NAMES[level - 1]  || 'LEGEND';
  const icon      = LEVEL_ICONS[level - 1]  || '👑';

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue:1, tension:80, friction:9, useNativeDriver:true }),
      Animated.timing(fadeAnim,  { toValue:1, duration:400, useNativeDriver:true }),
    ]).start();
    const t = setTimeout(onDismiss, 3400);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={[styles.fullScreen,{backgroundColor:'rgba(0,6,20,0.96)',justifyContent:'center',alignItems:'center'}]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onDismiss} />
      <Animated.View style={[styles.bannerCard,{opacity:fadeAnim,transform:[{scale:scaleAnim}]}]}>
        <Text style={styles.bannerIcon}>{icon}</Text>
        <Text style={[styles.bannerSub,{color}]}>LEVEL {level} / {MAX_LVL}</Text>
        <Text style={[styles.bannerTitle,{textShadowColor:color}]}>{name}</Text>
        <Text style={styles.bannerDesc}>Sort <Text style={{color}}>{nc} coin types</Text> · 4 matching = rack clears</Text>

        {/* Level progress dots */}
        <View style={styles.progressDots}>
          {Array.from({length:MAX_LVL}).map((_,i)=>(
            <View key={i} style={[styles.dot,{
              backgroundColor: i < level ? color : 'rgba(255,255,255,0.12)',
              borderColor: i < level ? color : 'rgba(255,255,255,0.18)',
              shadowColor: color, shadowOpacity: i < level ? 0.8 : 0, shadowRadius: 6,
            }]}>
              {i < level && <Text style={{fontSize:14}}>{LEVEL_ICONS[i]}</Text>}
            </View>
          ))}
        </View>

        {/* Coin preview */}
        <View style={styles.coinPreview}>
          {Array.from({length:nc},(_,i)=>i+1).map(d=>(
            <View key={d} style={{margin:4}}>
              <CoinFace denom={d} size={32} glow />
            </View>
          ))}
        </View>

        <Text style={styles.bannerTap}>tap anywhere to start</Text>
      </Animated.View>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   DEAL EXPLAINER MODAL
══════════════════════════════════════════════════════════ */
function DealModal({ onClose }) {
  const scaleAnim = useRef(new Animated.Value(0.75)).current;
  useEffect(()=>{
    Animated.spring(scaleAnim,{toValue:1,tension:80,friction:9,useNativeDriver:true}).start();
  },[]);

  const items = [
    {i:'🔓',t:'Unlocks a Rack',    d:'Adds one empty buffer slot when you\'re stuck.'},
    {i:'💰',t:'Costs 1 Token',     d:'You start each level with 3 deals. Use them wisely!'},
    {i:'🎁',t:'Earn Free Deals',   d:'Every 2 sorted racks rewards you a bonus deal token.'},
    {i:'🧠',t:'Use Strategically', d:'Best when no moves remain. Early use wastes buffer space.'},
  ];

  return (
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View style={[styles.dealModal,{transform:[{scale:scaleAnim}]}]}>
        <Text style={styles.dealModalIcon}>🪙</Text>
        <Text style={styles.dealModalTitle}>Deal Button</Text>
        <Text style={styles.dealModalSub}>Your secret weapon</Text>

        {items.map((it,i)=>(
          <View key={i} style={styles.dealRow}>
            <Text style={styles.dealRowIcon}>{it.i}</Text>
            <View style={{flex:1}}>
              <Text style={styles.dealRowTitle}>{it.t}</Text>
              <Text style={styles.dealRowDesc}>{it.d}</Text>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.dealCloseBtn} onPress={onClose}>
          <Text style={styles.dealCloseTxt}>Got it! ✓</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   WIN SCREEN
══════════════════════════════════════════════════════════ */
function WinScreen({ score, moves, onRestart }) {
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  useEffect(()=>{
    Animated.spring(scaleAnim,{toValue:1,tension:60,friction:8,useNativeDriver:true}).start();
  },[]);
  return (
    <View style={[styles.fullScreen,{backgroundColor:'rgba(0,6,18,0.92)',justifyContent:'center',alignItems:'center'}]}>
      <Animated.View style={[styles.winCard,{transform:[{scale:scaleAnim}]}]}>
        <Text style={styles.winTrophy}>🏆</Text>
        <Text style={styles.winTitle}>YOU WIN!</Text>
        <Text style={styles.winDesc}>All {MAX_LVL} levels mastered!</Text>
        <Text style={styles.winScore}>{score}</Text>
        <Text style={styles.winScoreLabel}>FINAL SCORE</Text>
        <Text style={styles.winMoves}>{moves} moves total</Text>
        <TouchableOpacity style={styles.replayBtn} onPress={onRestart} activeOpacity={0.85}>
          <LinearGradient colors={['#ff9800','#e55100']} style={styles.replayGrad}>
            <Text style={styles.replayTxt}>Play Again 🎮</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════ */
export default function App() {
  const [screen,    setScreen]    = useState('intro');
  const [racks,     setRacks]     = useState(()=>makeLevel(1));
  const [sel,       setSel]       = useState(null);
  const [completing,setCompleting]= useState(new Set());
  const [level,     setLevel]     = useState(1);
  const [score,     setScore]     = useState(0);
  const [moves,     setMoves]     = useState(0);
  const [deals,     setDeals]     = useState(STARTING_DEALS);
  const [sorted,    setSorted]    = useState(0);
  const [muted,     setMuted]     = useState(false);
  const [dealHelp,  setDealHelp]  = useState(false);
  const [toast,     setToast]     = useState(null);
  const toastTmr = useRef(null);
  const xpAnim   = useRef(new Animated.Value(0)).current;

  const nc       = Math.min(level + 1, 8);
  const lvlColor = LEVEL_COLORS[level-1] || '#5088b8';
  const xpPct    = ((level-1)/(MAX_LVL-1));

  // Animate XP bar
  useEffect(()=>{
    Animated.spring(xpAnim,{toValue:xpPct,useNativeDriver:false,tension:40}).start();
  },[xpPct]);

  const floatCoin = (sel!==null && Array.isArray(racks[sel]) && racks[sel].length>0)
    ? racks[sel][racks[sel].length-1] : null;
  const validDrop = getValidTargets(racks, sel);

  function notify(msg, color='#fff') {
    clearTimeout(toastTmr.current);
    setToast({msg,color});
    toastTmr.current = setTimeout(()=>setToast(null), 2200);
  }

  function tap(idx) {
    const rack = racks[idx];
    if (rack===null || completing.has(idx)) return;

    if (sel===null) {
      if (rack.length>0) { audioEngine.pick(); Haptics.selectionAsync(); setSel(idx); }
      return;
    }
    if (sel===idx) { setSel(null); return; }

    if (!canDrop(rack, floatCoin)) {
      audioEngine.bad(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      notify(rack.length>=CAP ? '🚫 Rack is full!' : `${COINS[rack[rack.length-1]].n} ≠ ${COINS[floatCoin].n}`, '#ff7070');
      setSel(null); return;
    }

    const nr = moveCoin(racks, sel, idx);
    setMoves(m=>m+1); audioEngine.drop();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRacks(nr); setSel(null);

    if (isRackDone(nr[idx])) {
      const d   = nr[idx][0];
      const pts = SCORE_PER_SORT(d);
      setScore(s=>s+pts);
      audioEngine.sort();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify(`🏆 ${COINS[d].n} sorted! +${pts}`, COINS[d].g);

      setCompleting(c=>{const n=new Set(c);n.add(idx);return n;});
      setSorted(prev=>{
        const ns = prev + 1;
        if ((ns % DEALS_PER_SORT) === 0) setDeals(d2=>Math.min(d2+1,MAX_DEALS));
        return ns;
      });

      setTimeout(()=>{
        setRacks(p=>p.map((q,i)=>i===idx?[]:q));
        setCompleting(p=>{const s=new Set(p);s.delete(idx);return s;});

        setSorted(ns=>{
          if (ns>=nc) {
            setTimeout(()=>{
              if (level>=MAX_LVL) { audioEngine.win(); setScreen('win'); return; }
              const nl=level+1;
              audioEngine.levelUp();
              setLevel(nl); setRacks(makeLevel(nl)); setSel(null);
              setCompleting(new Set()); setSorted(0);
              setDeals(d=>Math.min(d+2,MAX_DEALS));
              setScreen('levelBanner');
            },700);
          }
          return ns;
        });
      },1500);
    }
  }

  function deal() {
    if (deals<=0) { notify('No deals! Keep sorting.','#ff8080'); return; }
    const li = racks.findIndex(r=>r===null);
    if (li===-1) { notify('All racks open!','#ffcc60'); return; }
    setRacks(p=>{const n=[...p];n[li]=[];return n;});
    setDeals(d=>d-1);
    audioEngine.deal();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    notify('🔓 Rack unlocked!','#ffe566');
  }

  function restart() {
    setLevel(1);setScore(0);setMoves(0);setDeals(STARTING_DEALS);setSorted(0);
    setRacks(makeLevel(1));setSel(null);setCompleting(new Set());setScreen('intro');
  }

  function toggleMute(){
    const m=!muted; setMuted(m); audioEngine.setMuted(m);
  }

  const row1 = racks.slice(0,5);
  const row2 = racks.slice(5,10);

  if (screen==='intro')       return <IntroScreen onPlay={()=>setScreen('levelBanner')} />;
  if (screen==='levelBanner') return <LevelBanner level={level} onDismiss={()=>setScreen('game')} />;
  if (screen==='win')         return <WinScreen score={score} moves={moves} onRestart={restart} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#bac8d6','#a4b4c2','#90a4b4']} style={styles.gameContainer}>

        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.gearWrap}>
            <Text style={[styles.gearLevel,{color:lvlColor}]}>{level}</Text>
            <Text style={styles.gearIcon}>{LEVEL_ICONS[level-1]}</Text>
          </View>

          <View style={styles.xpWrap}>
            <View style={styles.xpBarBack}>
              <Animated.View style={[styles.xpBarFill, {
                width: xpAnim.interpolate({inputRange:[0,1],outputRange:['0%','100%']}),
                backgroundColor: lvlColor,
              }]}/>
            </View>
            <Text style={styles.xpLabel}>
              {LEVEL_ICONS[level-1]} {LEVEL_NAMES[level-1]}  ·  {sorted}/{nc} sorted
            </Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity onPress={toggleMute} style={styles.muteBtn}>
              <Text style={styles.muteTxt}>{muted?'🔇':'🔊'}</Text>
            </TouchableOpacity>
            <View style={styles.scorePill}>
              <Text style={styles.scoreLbl}>SCORE</Text>
              <Text style={styles.scoreVal}>{score}</Text>
            </View>
          </View>
        </View>

        {/* ── MOVES + COIN CHIPS ── */}
        <View style={styles.subStats}>
          <Text style={styles.movesText}>Moves: {moves}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1}}>
            {Array.from({length:nc},(_,i)=>i+1).map(d=>(
              <View key={d} style={[styles.coinChip,{borderColor:COINS[d].e}]}>
                <View style={[styles.coinDot,{backgroundColor:COINS[d].a}]}/>
                <Text style={[styles.coinChipTxt,{color:COINS[d].b}]}>{COINS[d].n}</Text>
              </View>
            ))}
          </ScrollView>
          {/* Progress dots */}
          <View style={styles.progressMini}>
            {Array.from({length:nc}).map((_,i)=>(
              <View key={i} style={[styles.miniDot,{
                backgroundColor: i<sorted ? '#38cc10' : 'rgba(0,0,0,0.18)',
                borderColor: i<sorted ? '#28aa08' : '#7090a0',
              }]}/>
            ))}
          </View>
        </View>

        {/* ── TOAST ── */}
        {toast&&(
          <View style={styles.toast}>
            <Text style={[styles.toastTxt,{color:toast.color}]}>{toast.msg}</Text>
          </View>
        )}

        {/* ── RACK GRID ── */}
        <View style={styles.gridContainer}>
          <View style={styles.gridInner}>
            <View style={styles.row}>
              {row1.map((rack,ci)=>(
                <RackSlot key={ci} rack={rack} idx={ci}
                  sel={sel} completing={completing} validDrop={validDrop} onTap={tap}/>
              ))}
            </View>
            <View style={[styles.row,{marginTop:8}]}>
              {row2.map((rack,ci)=>(
                <RackSlot key={5+ci} rack={rack} idx={5+ci}
                  sel={sel} completing={completing} validDrop={validDrop} onTap={tap}/>
              ))}
            </View>
          </View>
        </View>

        {/* ── DEAL PIPS ── */}
        <View style={styles.dealPipsRow}>
          <Text style={styles.dealPipsLabel}>Deals: </Text>
          {Array.from({length:MAX_DEALS}).map((_,i)=>(
            <View key={i} style={[styles.pip,{
              backgroundColor: i<deals ? '#ffc820' : 'rgba(0,0,0,0.18)',
              borderColor: i<deals ? '#e09800' : '#7890a0',
              shadowColor:'#ffc820', shadowOpacity: i<deals?0.7:0, shadowRadius:4,
            }]}/>
          ))}
        </View>

        {/* ── DEAL BUTTON ── */}
        <View style={styles.dealBtnWrap}>
          <TouchableOpacity
            onPress={deal}
            activeOpacity={deals>0?0.82:1}
            disabled={deals<=0}
            style={[styles.dealBtn,{opacity:deals>0?1:0.48}]}
          >
            <LinearGradient
              colors={deals>0?['#3c3830','#242018']:['#505050','#3a3a3a']}
              style={styles.dealBtnGrad}
            >
              {/* Animated coin stack icon */}
              <View style={styles.dealCoins}>
                {[0,1,2].map(i=>(
                  <View key={i} style={[styles.dealCoin,{
                    left:i*10, bottom:i*3,
                    backgroundColor:COINS[3].a,
                  }]}/>
                ))}
              </View>
              <Text style={[styles.dealTxt,{color:deals>0?'#44d038':'#606060'}]}>Deal!</Text>
              {deals>0&&<View style={styles.dealCount}><Text style={styles.dealCountTxt}>×{deals}</Text></View>}
            </LinearGradient>
          </TouchableOpacity>

          {/* Info button */}
          <TouchableOpacity style={styles.infoBtn} onPress={()=>setDealHelp(true)}>
            <Text style={styles.infoTxt}>?</Text>
          </TouchableOpacity>
        </View>

        {/* ── INSTRUCTIONS HINT ── */}
        <View style={styles.hintBox}>
          <Text style={styles.hintTxt}>
            Tap a rack to pick top coin → tap target to drop.{'\n'}
            <Text style={{color:'#886600'}}>4 matching = rack clears with confetti! 🎊</Text>
          </Text>
        </View>

      </LinearGradient>

      {dealHelp && <DealModal onClose={()=>setDealHelp(false)}/>}
    </SafeAreaView>
  );
}

/* ══════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  safeArea:         { flex:1, backgroundColor:'#b8c6d4' },
  fullScreen:       { flex:1, alignItems:'center', justifyContent:'center' },
  gameContainer:    { flex:1, alignItems:'center', paddingBottom:20 },

  // Intro
  coinOrbit: { width:280, height:280, alignItems:'center', justifyContent:'center', position:'relative', marginBottom:24 },
  glowCircle:{ position:'absolute', width:160, height:160, borderRadius:80, backgroundColor:'rgba(255,200,0,0.15)' },
  introText: { alignItems:'center', paddingHorizontal:24 },
  introSubtitle:{ fontSize:11,letterSpacing:8,fontWeight:'800',color:'rgba(255,200,100,0.65)',marginBottom:6 },
  introTitle:   { fontSize:52,fontWeight:'900',letterSpacing:5,color:'#ffe060',marginBottom:4 },
  introTagline: { fontSize:13,letterSpacing:3,fontWeight:'700',color:'rgba(160,192,255,0.65)',marginBottom:28 },
  tipsRow:      { flexDirection:'row', gap:12, marginBottom:32 },
  tipBox:       { alignItems:'center', backgroundColor:'rgba(255,255,255,0.06)', borderRadius:12,
                  paddingHorizontal:12, paddingVertical:10, borderWidth:1, borderColor:'rgba(255,255,255,0.10)' },
  tipEmoji:     { fontSize:22, marginBottom:4 },
  tipText:      { fontSize:10, color:'rgba(160,192,255,0.65)', fontWeight:'700' },
  playBtn:      { borderRadius:22, overflow:'hidden', marginBottom:10 },
  playBtnGrad:  { paddingHorizontal:52, paddingVertical:18 },
  playBtnText:  { fontSize:22, fontWeight:'900', color:'#1a0800', letterSpacing:2 },
  musicNote:    { fontSize:11, color:'rgba(255,255,255,0.28)', fontWeight:'700' },

  // Level Banner
  bannerCard:  { backgroundColor:'rgba(10,20,38,0.96)', borderRadius:28, padding:30,
                 alignItems:'center', width:SW*0.88, borderWidth:1.5, borderColor:'rgba(255,255,255,0.10)' },
  bannerIcon:  { fontSize:80, marginBottom:8 },
  bannerSub:   { fontSize:13, fontWeight:'900', letterSpacing:5, marginBottom:5 },
  bannerTitle: { fontSize:44, fontWeight:'900', color:'#fff', letterSpacing:3, marginBottom:6,
                 textShadowOffset:{width:0,height:0}, textShadowRadius:28 },
  bannerDesc:  { fontSize:14, color:'rgba(200,218,240,0.75)', fontWeight:'700', marginBottom:22, textAlign:'center' },
  progressDots:{ flexDirection:'row', gap:9, marginBottom:20 },
  dot:         { width:34,height:34,borderRadius:17,borderWidth:2.5,alignItems:'center',justifyContent:'center',
                 elevation:4, shadowOffset:{width:0,height:2}, shadowRadius:6 },
  coinPreview: { flexDirection:'row', flexWrap:'wrap', justifyContent:'center', marginBottom:20, maxWidth:300 },
  bannerTap:   { fontSize:12, color:'rgba(255,255,255,0.35)', fontWeight:'700', letterSpacing:1 },

  // Deal Modal
  modalOverlay:{ ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,6,20,0.82)',
                 alignItems:'center', justifyContent:'center', zIndex:900 },
  dealModal:   { backgroundColor:'#192838', borderRadius:24, padding:26, width:SW*0.88,
                 borderWidth:1.5, borderColor:'rgba(255,255,255,0.12)' },
  dealModalIcon:  { fontSize:44, textAlign:'center', marginBottom:6 },
  dealModalTitle: { fontSize:22, fontWeight:'900', color:'#44d038', textAlign:'center',letterSpacing:0.5,marginBottom:2 },
  dealModalSub:   { fontSize:12, color:'rgba(160,190,220,0.6)', fontWeight:'700',textAlign:'center',marginBottom:16 },
  dealRow:     { flexDirection:'row', gap:12, marginBottom:12, alignItems:'flex-start' },
  dealRowIcon: { fontSize:22, lineHeight:28 },
  dealRowTitle:{ fontSize:13, fontWeight:'900', color:'#b8d8f0', marginBottom:2 },
  dealRowDesc: { fontSize:11, color:'#607888', fontWeight:'700', lineHeight:17 },
  dealCloseBtn:{ backgroundColor:'#1060d0', borderRadius:12, padding:13, marginTop:4, alignItems:'center' },
  dealCloseTxt:{ color:'#fff', fontSize:16, fontWeight:'900' },

  // Win
  winCard:    { backgroundColor:'#fffde0', borderRadius:28, padding:40, alignItems:'center', width:SW*0.86 },
  winTrophy:  { fontSize:72, marginBottom:8 },
  winTitle:   { fontSize:34, fontWeight:'900', color:'#2a1000', letterSpacing:1, marginBottom:4 },
  winDesc:    { fontSize:14, color:'#6a3400', fontWeight:'700', marginBottom:14 },
  winScore:   { fontSize:44, fontWeight:'900', color:'#b85000' },
  winScoreLabel:{ fontSize:11, color:'#8a5020', fontWeight:'800', letterSpacing:2, marginBottom:4 },
  winMoves:   { fontSize:13, color:'#8a6040', fontWeight:'700', marginBottom:24 },
  replayBtn:  { borderRadius:16, overflow:'hidden' },
  replayGrad: { paddingHorizontal:38, paddingVertical:15 },
  replayTxt:  { fontSize:20, fontWeight:'900', color:'#fff', letterSpacing:0.5 },

  // Game header
  header:     { flexDirection:'row', alignItems:'center', gap:10, width:'100%', paddingHorizontal:12, paddingTop:12, paddingBottom:6 },
  gearWrap:   { width:58, height:58, backgroundColor:'rgba(0,0,0,0.14)', borderRadius:29,
                alignItems:'center', justifyContent:'center', borderWidth:2,
                borderColor:'rgba(255,255,255,0.45)', flexShrink:0 },
  gearLevel:  { fontSize:22, fontWeight:'900' },
  gearIcon:   { fontSize:12 },
  xpWrap:     { flex:1, minWidth:0 },
  xpBarBack:  { height:26, borderRadius:13, backgroundColor:'rgba(0,0,0,0.18)', overflow:'hidden',
                borderWidth:2.5, borderColor:'rgba(255,255,255,0.70)',
                shadowColor:'#000', shadowOpacity:0.18, shadowRadius:4, shadowOffset:{width:0,height:2} },
  xpBarFill:  { position:'absolute', top:0, bottom:0, left:0, borderRadius:11 },
  xpLabel:    { fontSize:10, color:'#4e6070', fontWeight:'700', marginTop:3, letterSpacing:0.3 },
  headerRight:{ alignItems:'flex-end', gap:4 },
  muteBtn:    { backgroundColor:'rgba(0,0,0,0.16)', borderRadius:8, paddingHorizontal:8, paddingVertical:3,
                borderWidth:1.5, borderColor:'rgba(255,255,255,0.32)' },
  muteTxt:    { fontSize:15 },
  scorePill:  { backgroundColor:'rgba(0,0,0,0.18)', borderRadius:9, paddingHorizontal:9, paddingVertical:3,
                alignItems:'center', borderWidth:1, borderColor:'rgba(255,255,255,0.35)' },
  scoreLbl:   { fontSize:8, color:'#668090', fontWeight:'800', letterSpacing:1 },
  scoreVal:   { fontSize:16, fontWeight:'900', color:'#344858' },

  // Sub-stats
  subStats:   { flexDirection:'row', alignItems:'center', gap:7, width:'100%', paddingHorizontal:12, paddingBottom:2 },
  movesText:  { fontSize:10, color:'#506070', fontWeight:'700', flexShrink:0 },
  coinChip:   { flexDirection:'row', alignItems:'center', gap:3, backgroundColor:'rgba(0,0,0,0.14)',
                borderRadius:12, paddingHorizontal:7, paddingVertical:1.5, borderWidth:1.5, marginRight:3 },
  coinDot:    { width:18, height:7, borderRadius:4 },
  coinChipTxt:{ fontSize:9, fontWeight:'800' },
  progressMini:{ flexDirection:'row', gap:3, flexShrink:0 },
  miniDot:    { width:9, height:9, borderRadius:4.5, borderWidth:1.5 },

  // Toast
  toast:      { backgroundColor:'rgba(6,12,24,0.88)', borderRadius:20,
                paddingHorizontal:22, paddingVertical:5, marginBottom:2,
                alignSelf:'center' },
  toastTxt:   { fontSize:13, fontWeight:'800' },

  // Grid
  gridContainer:{ width:'100%', paddingHorizontal:8 },
  gridInner:  { backgroundColor:'rgba(0,0,0,0.10)', borderRadius:22,
                paddingHorizontal:5, paddingTop:12, paddingBottom:16,
                shadowColor:'#000', shadowOpacity:0.18, shadowRadius:8, shadowOffset:{width:0,height:4}, elevation:4 },
  row:        { flexDirection:'row', justifyContent:'center' },

  // Deal
  dealPipsRow: { flexDirection:'row', alignItems:'center', gap:5, marginTop:8 },
  dealPipsLabel:{ fontSize:11, color:'#688090', fontWeight:'700' },
  pip:         { width:13, height:13, borderRadius:6.5, borderWidth:1.5,
                 shadowOffset:{width:0,height:0} },
  dealBtnWrap: { flexDirection:'row', alignItems:'center', gap:8, width:'100%', paddingHorizontal:18, marginTop:8 },
  dealBtn:     { flex:1, borderRadius:20, overflow:'hidden',
                 shadowColor:'#000', shadowOpacity:0.40, shadowRadius:10, shadowOffset:{width:0,height:5}, elevation:6 },
  dealBtnGrad: { flexDirection:'row', alignItems:'center', justifyContent:'center',
                 gap:14, paddingVertical:14, paddingHorizontal:18 },
  dealCoins:   { width:46, height:28, position:'relative' },
  dealCoin:    { position:'absolute', width:28, height:11, borderRadius:6,
                 borderWidth:1.5, borderColor:'rgba(0,0,0,0.30)' },
  dealTxt:     { fontSize:28, fontWeight:'900', fontStyle:'italic', letterSpacing:0.5 },
  dealCount:   { backgroundColor:'rgba(68,208,52,0.14)', borderWidth:1,
                 borderColor:'rgba(68,208,52,0.36)', borderRadius:9, paddingHorizontal:9, paddingVertical:2 },
  dealCountTxt:{ fontSize:12, color:'#88ee80', fontWeight:'800' },
  infoBtn:     { width:42, height:42, borderRadius:21, backgroundColor:'rgba(0,0,0,0.22)',
                 borderWidth:1.5, borderColor:'rgba(255,255,255,0.35)',
                 alignItems:'center', justifyContent:'center' },
  infoTxt:     { fontSize:18, fontWeight:'900', color:'rgba(255,255,255,0.75)' },

  // Hint
  hintBox:    { marginTop:8, marginHorizontal:18, backgroundColor:'rgba(0,0,0,0.10)',
                borderRadius:12, paddingHorizontal:14, paddingVertical:8,
                borderWidth:1, borderColor:'rgba(255,255,255,0.22)' },
  hintTxt:    { fontSize:11, color:'#4e6070', fontWeight:'700', textAlign:'center', lineHeight:18 },
});

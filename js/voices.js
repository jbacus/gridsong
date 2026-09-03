'use strict';
(function () {
// Voice list, defaults, scales and synth patch generation.
// Voice names and per-layer defaults are transcribed from the TENORI-ON manual
// (Voice List p.119-121, Data Storage table p.39-41). The synthesis itself is an
// original Web Audio approximation: the real instrument plays Yamaha samples.
const TN = window.TN || (window.TN = {});

TN.VOICE_NAMES = [
  ['Photon','Photopia','Pearl','Pulse','Cell','Pixel','Serene','Electron','Winter','SoftMmb','SoftAcco','SoftHarm','GrandPno','QuietPno','OldPiano','User1'],
  ['eKalimba','LiteOrg','GlassTap','Drop','Shimmery','Mist','Acorn','Chime','ThumbPno','ToyTrain','ToyBanjo','LazyBass','Crocus','CandyCan','Peaceful','User2'],
  ['OrgFlute','GtrHarmo','GreenFlt','Lonely','Murmur','OrganLT','TinyWind','Bassoon','Hopper','PopEcho','PopStr','Maple','ToyRobot','Tropical','Floating','User3'],
  ['NMCanon','LeedPlus','DotGame','HardBeep','PopFlang','PeekTone','RetroPop','SonarPad','CaveDrop','DullBeep','SnapStr','MellowB','BasicB','PowerB','MetalB','SlowB'],
  ['EchoBass','PizzStr','SinePop','PowerPop','Blip','WindPass','DonPiyo','MetalHit','BuzzPop','FlowOut','Spring','BublEcho','Pico','LightPop','RainDrop','Creak'],
  ['TreeFrog','Squeeze','FootStep','Carib','Point','EchoTom','PureTom','TinBox','Boom','LowBoom','EchoBoom','SoftBoom','LargeBox','Barrel','AirSynth','SteelDrm'],
  ['HighKit','BumpKit','StompKit','BangKit','ScrubKit','HandKit','MouthKit','EastKit','EastKit2','EchoKit','PowerKit','SnapKit','LowKit','MidKit','Knocks','Stomp'],
  ['Square','Aroma','Sprout','Spot','Quasar','BeanBag','TipToe','Gemini','Apollo','Hexagon','Green','DoLoop','Milli','Centi','Deca','Hect'],
  ['Peanuts','Walnut','Ping','Pong','Mallet','HumOrgan','BuzOrgan','PopOrgan','JazOrgan','ResOrgan','FuzOrgan','PufOrgan','PicOrgan','DropEcho','Sesame','Delta'],
  ['Marble','PinBall','TinToy','Chick','Vibes','SineMmb','Harp','Opinion','Stuffy','Sulky','Log','Oscillat','Grief','Bubble','Plankton','Popcorn'],
  ['Acordion','Viola','Cello','Violin','Contrabs','SfotStr','Strings','Piccolo','Flute','Recorder','PanFlute','Bagpipe','Clarinet','Oboe','Harmnica','El.Grand'],
  ['LadyBird','Tsugumi','WhiteEye','NewHope','Trickle','MayFly','Moth','GlasPerc','SineLead','Flick','Doze','Sleep','ElecToy','Frog','RadioPno','Droid'],
  ['Children','Aqua','Pierrot','Musicbox','Fairy','Ukulet','Molecule','Sparkler','AirTweet','Neutrino','CosmoRay','Elf','Elfin','ChitChat','RayDrop','Ozone'],
  ['Chrome','Oak','Awake','Ebony','Epoxy','Pendulum','Xylophon','Marimba','MetalXY','SoftFoot','PopUP','Helium','Locust','TinyBell','PopVibes','Balimba'],
  ['Candera','Orbit','Helix','Fade','Appear','SlowRay','PhaseOrg','Sunspot','Whistle','Corona','Diode','Zone','Venus','Mercury','Polar','Pai'],
  ['SlowFlux','AirFlow','Dynamo','Field','Closed','Parallel','Proton','Radiator','Neutron','Particle','Aerial','Ion','Glow','Spiral','Oxygen','Velocity'],
];

// [category, index] (1-based, matches the "VV/HH" display) per layer 1..16
TN.DEFAULT_INSTRUMENT = [[1,1],[2,15],[3,1],[4,8],[5,3],[6,10],[7,10],[8,5],[9,1],[10,13],[11,12],[12,1],[13,1],[14,4],[15,2],[16,2]];

// [type, size, mode] per layer 1..16
TN.DEFAULT_ANIM = [
  ['Circle',3,'Expand'],['Square',3,'Expand'],['Diamond',4,'Shrink'],['Cross',3,'Expand'],['Plus',3,'Expand'],['Circle',4,'Shrink'],['Diamond',5,'Expand'],
  ['Circle',4,'Expand'],['Square',3,'Shrink'],['Diamond',4,'Expand'],['Plus',6,'Shrink'],['Circle',5,'Expand'],['Square',4,'Expand'],
  ['Simple',1,'None'],['Circle',4,'Pulse'],['VLine',1,'None'],
];
TN.ANIM_TYPES = ['Simple','Circle','Square','Diamond','Cross','Plus'];

TN.MODE_OF_LAYER = ['score','score','score','score','score','score','score','random','random','random','random','draw','draw','bounce','push','solo'];
TN.MODE_LABEL = {score:'Score', random:'Random', draw:'Draw', bounce:'Bounce', push:'Push', solo:'Solo'};

// Master scale note assignments (manual p.44). Index 0 = bottom row = C3 (MIDI 60).
TN.SCALES = {
  Ionian:[0,2,4,5,7,9,11], Dorian:[0,2,3,5,7,9,10], Phrygian:[0,1,3,5,7,8,10], Lydian:[0,2,4,6,7,9,11],
  Mixolydian:[0,2,4,5,7,9,10], Aeolian:[0,2,3,5,7,8,10], Locrian:[0,1,3,5,6,8,10],
  Chromatic:[0,1,2,3,4,5,6,7,8,9,10,11], OKINAWA:[0,4,5,7,11],
};
TN.SCALE_NAMES = Object.keys(TN.SCALES);
TN.scaleMidi = function (scale, index) {
  const s = TN.SCALES[scale] || TN.SCALES.Ionian;
  return 60 + 12 * Math.floor(index / s.length) + s[index % s.length];
};

TN.REVERB_TYPES = ['NO EFFECT','HALL1','HALL2','ROOM1','ROOM2','ROOM3','STAGE1','STAGE2','PLATE1','PLATE2'];
TN.CHORUS_TYPES = ['NO EFFECT','CHORUS1','CHORUS2','FLANGR1','FLANGR2'];

TN.voiceName = (cat, idx) => TN.VOICE_NAMES[cat - 1][idx - 1];
TN.voiceLabel = (cat, idx) => String(cat).padStart(2, '0') + '/' + String(idx).padStart(2, '0') + ':' + TN.voiceName(cat, idx);
TN.isDrumVoice = (cat) => cat === 7;
TN.isUserVoice = (cat, idx) => idx === 16 && cat <= 3;

// ---- deterministic patch generation -------------------------------------
function rng(cat, idx) {
  let s = ((cat * 73856093) ^ (idx * 19349663)) >>> 0 || 7;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const TYPES = ['sine', 'triangle', 'square', 'sawtooth'];

TN.patchFor = function (cat, idx) {
  const r = rng(cat, idx);
  const v = (lo, hi) => lo + (hi - lo) * r();
  const pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const name = TN.voiceName(cat, idx);
  const p = {
    name, cat, idx, kind: 'tone',
    oscs: [{ type: 'sine', ratio: 1, gain: 1, detune: 0 }],
    fm: null, pitchEnv: null, env: { a: 0.005, d: 0.4, s: 0, r: 0.15 },
    filter: null, noise: null, sustain: false, evolve: null, vibrato: null, echo: null, level: 0.8,
  };
  if (TN.isUserVoice(cat, idx)) { p.kind = 'user'; return p; }
  if (cat === 7) { p.kind = 'kit'; p.kit = TN.kitFor(idx); return p; }

  switch (cat) {
    case 1: // soft electronic bells, pianos at 13-15
      if (idx >= 13 && idx <= 15) {
        p.oscs = [{ type: 'triangle', ratio: 1, gain: 1 }, { type: 'sine', ratio: 2, gain: 0.35 }, { type: 'sine', ratio: 3, gain: 0.12 }, { type: 'sawtooth', ratio: 1, gain: 0.08, detune: 4 }];
        p.env = { a: 0.004, d: idx === 15 ? 0.9 : 1.6, s: 0, r: 0.25 };
        p.filter = { type: 'lowpass', base: 6, min: 600, q: 0.7, envAmt: 4, decay: 0.25 };
        p.noise = { gain: 0.03, decay: 0.02, hp: 2000 }; p.level = 0.9;
      } else {
        p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'sine', ratio: pick([2, 3, 4]), gain: v(0.1, 0.35) }];
        p.fm = { ratio: pick([2, 3, 3.5, 7]), index: v(0.2, 1.2), decay: v(0.05, 0.3) };
        p.env = { a: 0.003, d: v(0.3, 1.1), s: 0, r: 0.2 };
      }
      break;
    case 2: // kalimba / glass / small organ
      if (idx === 12) { // LazyBass
        p.oscs = [{ type: 'triangle', ratio: 0.5, gain: 1 }, { type: 'sine', ratio: 0.5, gain: 0.6 }];
        p.env = { a: 0.01, d: 0.5, s: 0.2, r: 0.2 }; p.filter = { type: 'lowpass', base: 3, min: 200, q: 1, envAmt: 3, decay: 0.2 };
      } else if (idx === 2 || idx === 15) { // LiteOrg, Peaceful
        p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'sine', ratio: 2, gain: 0.5 }, { type: 'sine', ratio: 4, gain: 0.2 }, { type: 'triangle', ratio: 1, gain: 0.3, detune: 5 }];
        p.env = { a: 0.03, d: 0.4, s: 0.7, r: 0.3 }; p.vibrato = { rate: 5.5, depth: 6, delay: 0.3 };
      } else {
        p.oscs = [{ type: 'triangle', ratio: 1, gain: 1 }, { type: 'sine', ratio: 3, gain: v(0.1, 0.3) }];
        p.fm = { ratio: pick([3.5, 5, 6.3, 7]), index: v(0.4, 1.5), decay: v(0.04, 0.15) };
        p.env = { a: 0.002, d: v(0.25, 0.9), s: 0, r: 0.15 }; p.noise = { gain: 0.04, decay: 0.01, hp: 3000 };
      }
      break;
    case 3: // flutes, soft sustained
      p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'triangle', ratio: 1, gain: 0.35, detune: v(-6, 6) }, { type: 'sine', ratio: 2, gain: v(0.05, 0.25) }];
      p.env = { a: v(0.03, 0.12), d: 0.3, s: v(0.5, 0.85), r: 0.25 };
      p.noise = { gain: 0.02, decay: 0.15, hp: 1500 }; p.vibrato = { rate: v(4.5, 6), depth: v(4, 10), delay: 0.25 };
      if (idx === 8) p.oscs = [{ type: 'sawtooth', ratio: 0.5, gain: 0.7 }, { type: 'square', ratio: 0.5, gain: 0.3 }]; // Bassoon
      if (idx === 8) p.filter = { type: 'lowpass', base: 5, min: 300, q: 2, envAmt: 1, decay: 0.2 };
      if (idx === 10 || idx === 11) p.echo = { time: 0.3, fb: 0.35, level: 0.3 };
      break;
    case 4: // chip tunes; 12-16 basses
      if (idx >= 12) {
        p.oscs = [{ type: idx === 15 ? 'square' : 'sawtooth', ratio: 0.5, gain: 0.8 }, { type: 'sine', ratio: 0.5, gain: 0.6 }, { type: 'sawtooth', ratio: 0.5, gain: 0.25, detune: 7 }];
        p.env = { a: 0.005, d: v(0.2, 0.5), s: 0.35, r: 0.15 };
        p.filter = { type: 'lowpass', base: idx === 16 ? 1.5 : 3, min: 150, q: v(1, 4), envAmt: v(2, 6), decay: v(0.1, 0.35) }; p.level = 0.9;
      } else {
        p.oscs = [{ type: pick(['square', 'square', 'sawtooth', 'triangle']), ratio: 1, gain: 0.7 }, { type: 'square', ratio: pick([1, 2, 0.5]), gain: v(0.1, 0.4), detune: v(-10, 10) }];
        p.env = { a: 0.002, d: v(0.1, 0.4), s: idx === 8 ? 0.5 : 0, r: 0.08 };
        p.filter = { type: 'lowpass', base: 8, min: 800, q: 1, envAmt: 2, decay: 0.15 };
        if (idx === 5) p.echo = { time: 0.19, fb: 0.4, level: 0.35 };
        if (idx === 9) p.echo = { time: 0.42, fb: 0.5, level: 0.4 };
        p.pitchEnv = r() < 0.4 ? { amount: v(-12, 12), decay: 0.06 } : null; p.level = 0.55;
      }
      break;
    case 5: // pops & blips with echo
      p.oscs = [{ type: pick(['sine', 'sine', 'triangle']), ratio: 1, gain: 1 }];
      p.pitchEnv = { amount: v(-18, 24), decay: v(0.03, 0.12) };
      p.env = { a: 0.002, d: v(0.12, 0.4), s: 0, r: 0.1 };
      p.echo = { time: v(0.18, 0.4), fb: v(0.25, 0.5), level: v(0.25, 0.45) };
      if (idx === 1) { p.oscs = [{ type: 'triangle', ratio: 0.5, gain: 1 }, { type: 'sine', ratio: 0.5, gain: 0.5 }]; p.pitchEnv = null; p.env.d = 0.5; }
      if (idx === 8 || idx === 9) { p.fm = { ratio: 2.9, index: 3, decay: 0.08 }; }
      break;
    case 6: // tuned percussion, toms, booms
      p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'triangle', ratio: 1.5, gain: v(0.1, 0.3) }];
      p.pitchEnv = { amount: v(4, 14), decay: v(0.05, 0.2) };
      p.env = { a: 0.002, d: v(0.25, 1.0), s: 0, r: 0.1 };
      p.noise = { gain: v(0.05, 0.25), decay: v(0.02, 0.08), hp: v(400, 3000) };
      if (idx >= 9 && idx <= 13) { p.oscs[0].ratio = 0.5; p.env.d = v(0.6, 1.4); }
      if (idx === 6 || idx === 11) p.echo = { time: 0.3, fb: 0.4, level: 0.35 };
      if (idx === 16) { p.fm = { ratio: 2, index: 1.5, decay: 0.15 }; p.pitchEnv = null; p.env.d = 1.2; }
      if (idx === 15) { p.oscs = [{ type: 'sawtooth', ratio: 1, gain: 0.6 }]; p.filter = { type: 'lowpass', base: 4, min: 300, q: 3, envAmt: 8, decay: 0.3 }; p.pitchEnv = null; }
      break;
    case 8: // square-ish leads
      p.oscs = [{ type: 'square', ratio: 1, gain: 0.6 }, { type: pick(['square', 'triangle', 'sawtooth']), ratio: 1, gain: 0.4, detune: v(-12, 12) }];
      p.env = { a: 0.004, d: v(0.15, 0.5), s: v(0.2, 0.5), r: 0.12 };
      p.filter = { type: 'lowpass', base: v(3, 7), min: 500, q: v(0.7, 3), envAmt: v(1, 4), decay: v(0.1, 0.3) }; p.level = 0.6;
      if (idx === 12) p.echo = { time: 0.25, fb: 0.45, level: 0.4 };
      break;
    case 9: // organs and pings
      if (idx === 3 || idx === 4 || idx === 14) {
        p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }]; p.fm = { ratio: idx === 3 ? 4 : 2.5, index: 1.2, decay: 0.1 }; p.env = { a: 0.001, d: 0.35, s: 0, r: 0.1 };
        if (idx === 14) p.echo = { time: 0.33, fb: 0.45, level: 0.4 };
      } else if (idx >= 6 && idx <= 13) {
        const db = [1, 0.8, 0.5, 0.3, 0.2, 0.15].map((g) => g * v(0.4, 1.2));
        p.oscs = [1, 2, 3, 4, 6, 8].map((ratio, i) => ({ type: 'sine', ratio, gain: db[i] }));
        p.oscs.push({ type: 'square', ratio: 1, gain: idx === 11 ? 0.35 : 0.08 });
        p.env = { a: 0.01, d: 0.1, s: 0.9, r: 0.08 }; p.vibrato = { rate: 6.5, depth: 3, delay: 0 }; p.level = 0.55;
      } else {
        p.oscs = [{ type: 'triangle', ratio: 1, gain: 1 }, { type: 'sine', ratio: 2, gain: 0.3 }];
        p.fm = { ratio: 1, index: v(0.5, 2), decay: 0.12 }; p.env = { a: 0.002, d: v(0.3, 0.7), s: 0, r: 0.15 };
      }
      break;
    case 10: // mallets, harp, vibes
      p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'sine', ratio: 4, gain: v(0.05, 0.2) }];
      p.fm = { ratio: pick([3, 4, 7]), index: v(0.3, 1.3), decay: v(0.05, 0.3) };
      p.env = { a: 0.002, d: v(0.6, 1.6), s: 0, r: 0.2 };
      if (idx === 5 || idx === 6) p.vibrato = { rate: 5, depth: 12, delay: 0 };
      if (idx === 7) { p.oscs.push({ type: 'triangle', ratio: 1, gain: 0.4 }); p.fm = null; p.env.d = 1.8; }
      if (idx >= 8 && idx <= 13) { p.oscs = [{ type: 'square', ratio: 1, gain: 0.5 }, { type: 'sine', ratio: 1, gain: 0.5 }]; p.filter = { type: 'lowpass', base: 2, min: 300, q: 4, envAmt: 6, decay: 0.2 }; p.env.d = 0.5; }
      if (idx >= 14) { p.pitchEnv = { amount: v(-10, 10), decay: 0.05 }; p.env.d = 0.2; }
      break;
    case 11: // orchestral
      if (idx <= 7 || idx === 12) {
        p.oscs = [{ type: 'sawtooth', ratio: 1, gain: 0.5 }, { type: 'sawtooth', ratio: 1, gain: 0.5, detune: v(6, 14) }, { type: 'sawtooth', ratio: 1, gain: 0.3, detune: v(-14, -6) }];
        if (idx === 3 || idx === 5) p.oscs.forEach((o) => (o.ratio = 0.5));
        p.env = { a: v(0.08, 0.25), d: 0.3, s: 0.85, r: 0.35 };
        p.filter = { type: 'lowpass', base: v(2.5, 5), min: 400, q: 0.8, envAmt: 0.5, decay: 0.5 };
        p.vibrato = { rate: 5.2, depth: 8, delay: 0.4 }; p.level = 0.5;
        if (idx === 1) { p.oscs = [{ type: 'square', ratio: 1, gain: 0.5 }, { type: 'sawtooth', ratio: 1, gain: 0.4, detune: 8 }]; p.env.a = 0.03; }
        if (idx === 12) p.oscs.push({ type: 'sawtooth', ratio: 0.5, gain: 0.4 });
      } else if (idx === 16) {
        p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'sine', ratio: 2, gain: 0.4 }]; p.fm = { ratio: 14, index: 0.6, decay: 0.3 };
        p.env = { a: 0.003, d: 1.4, s: 0, r: 0.3 }; p.vibrato = { rate: 5, depth: 3, delay: 0.5 };
      } else {
        p.oscs = [{ type: idx === 13 ? 'square' : 'triangle', ratio: 1, gain: 0.8 }, { type: 'sine', ratio: 1, gain: 0.4 }, { type: 'sine', ratio: 2, gain: idx === 14 ? 0.5 : 0.15 }];
        if (idx === 8) p.oscs.forEach((o) => (o.ratio *= 2));
        p.env = { a: v(0.04, 0.1), d: 0.2, s: 0.8, r: 0.2 }; p.noise = { gain: 0.02, decay: 0.2, hp: 2000 };
        p.vibrato = { rate: v(5, 6.5), depth: v(5, 12), delay: 0.3 }; p.level = 0.6;
      }
      break;
    case 12: // FM birds and insects
      p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }];
      p.fm = { ratio: pick([1.41, 2.76, 3.3, 5.1, 1.99]), index: v(2, 7), decay: v(0.05, 0.3) };
      p.pitchEnv = { amount: v(-20, 20), decay: v(0.04, 0.15) };
      p.env = { a: 0.002, d: v(0.1, 0.5), s: 0, r: 0.1 };
      if (idx === 9) { p.fm = null; p.pitchEnv = null; p.env = { a: 0.01, d: 0.2, s: 0.7, r: 0.15 }; p.vibrato = { rate: 6, depth: 10, delay: 0.1 }; }
      if (idx === 15) { p.fm = { ratio: 1, index: 1.5, decay: 0.2 }; p.pitchEnv = null; p.env.d = 0.8; p.filter = { type: 'bandpass', base: 2, min: 500, q: 2, envAmt: 0, decay: 0.2 }; }
      if (idx === 16) p.echo = { time: 0.16, fb: 0.5, level: 0.4 };
      break;
    case 13: // music box & twinkly
      p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }, { type: 'sine', ratio: 3, gain: v(0.1, 0.3) }, { type: 'sine', ratio: 5, gain: v(0.02, 0.1) }];
      p.fm = { ratio: pick([7, 9, 11]), index: v(0.2, 0.7), decay: 0.08 };
      p.env = { a: 0.002, d: v(0.8, 2.0), s: 0, r: 0.3 }; p.level = 0.7;
      if (idx === 6) { p.oscs = [{ type: 'triangle', ratio: 1, gain: 1 }, { type: 'sawtooth', ratio: 1, gain: 0.15 }]; p.fm = null; p.env.d = 0.7; p.filter = { type: 'lowpass', base: 5, min: 500, q: 1, envAmt: 3, decay: 0.15 }; }
      if (idx === 9 || idx === 14) p.pitchEnv = { amount: v(5, 15), decay: 0.08 };
      if (idx === 15 || idx === 16) p.echo = { time: 0.28, fb: 0.4, level: 0.35 };
      break;
    case 14: // bounce mallets
      p.oscs = [{ type: 'sine', ratio: 1, gain: 1 }];
      p.fm = { ratio: pick([3, 4, 2, 6]), index: v(0.8, 2.5), decay: v(0.04, 0.12) };
      p.env = { a: 0.001, d: v(0.2, 0.6), s: 0, r: 0.1 };
      p.noise = { gain: 0.06, decay: 0.01, hp: 4000 };
      if (idx === 7 || idx === 8 || idx === 16) { p.oscs.push({ type: 'triangle', ratio: 1, gain: 0.5 }); p.env.d = idx === 8 ? 0.45 : 0.25; }
      if (idx === 12) p.pitchEnv = { amount: 12, decay: 0.08 };
      if (idx === 14) { p.fm.ratio = 11; p.env.d = 1.0; }
      break;
    case 15: // push-mode pads with time-based tonal change
      p.oscs = [{ type: pick(['sawtooth', 'triangle', 'square']), ratio: 1, gain: 0.5 }, { type: pick(['sawtooth', 'triangle']), ratio: 1, gain: 0.45, detune: v(5, 12) }, { type: 'sine', ratio: 0.5, gain: 0.3 }];
      p.env = { a: v(0.15, 0.5), d: 0.5, s: 1, r: v(0.4, 1.0) }; p.sustain = true;
      p.filter = { type: 'lowpass', base: 1.5, min: 200, q: v(1, 5), envAmt: 0, decay: 0.3 };
      p.evolve = { lfoRate: v(0.15, 0.6), lfoDepth: v(1, 4), sweepTo: v(6, 16), sweepTime: v(3, 8) };
      p.vibrato = { rate: v(0.3, 1), depth: v(3, 10), delay: 1 }; p.level = 0.45;
      if (idx === 9) { p.oscs = [{ type: 'sine', ratio: 2, gain: 1 }]; p.filter = null; p.evolve = null; p.vibrato = { rate: 5, depth: 25, delay: 0.5 }; p.level = 0.5; }
      break;
    case 16: // solo leads
      p.oscs = [{ type: pick(['sawtooth', 'square', 'triangle', 'sine']), ratio: 1, gain: 0.7 }, { type: 'sine', ratio: 1, gain: 0.3, detune: v(-8, 8) }];
      p.env = { a: v(0.005, 0.05), d: 0.2, s: 0.8, r: 0.15 };
      p.filter = { type: 'lowpass', base: v(3, 8), min: 500, q: v(0.7, 3), envAmt: v(1, 3), decay: 0.2 };
      p.vibrato = { rate: v(4.5, 6.5), depth: v(4, 14), delay: 0.2 }; p.level = 0.55;
      if (idx === 1 || idx === 2 || idx === 13) { p.env.a = 0.4; p.sustain = true; p.evolve = { lfoRate: 0.3, lfoDepth: 2, sweepTo: 8, sweepTime: 4 }; }
      break;
    default: break;
  }
  return p;
};

// Drum kits: 16 rows (0 = bottom) each a different instrument. Kit index varies tuning/decay/colour.
TN.kitFor = function (idx) {
  const r = rng(7, idx);
  const v = (lo, hi) => lo + (hi - lo) * r();
  const pitch = idx === 13 ? 0.8 : idx === 1 ? 1.25 : idx === 14 ? 1.05 : v(0.9, 1.15);
  const decay = idx === 3 || idx === 16 ? 0.7 : idx === 10 ? 1.3 : v(0.85, 1.2);
  const soft = idx === 6 || idx === 7 || idx === 15;
  const rows = [
    { t: 'kick', f: 55 * pitch, d: 0.45 * decay },
    { t: 'kick', f: 42 * pitch, d: 0.7 * decay },
    { t: 'snare', f: 190 * pitch, d: 0.22 * decay },
    { t: 'snare', f: 240 * pitch, d: 0.14 * decay },
    { t: 'clap', f: 0, d: 0.2 * decay },
    { t: 'hat', f: 0, d: 0.05 * decay },
    { t: 'hat', f: 0, d: 0.3 * decay },
    { t: 'tom', f: 90 * pitch, d: 0.4 * decay },
    { t: 'tom', f: 130 * pitch, d: 0.35 * decay },
    { t: 'tom', f: 180 * pitch, d: 0.3 * decay },
    { t: 'rim', f: 900 * pitch, d: 0.06 },
    { t: 'cowbell', f: 560 * pitch, d: 0.25 * decay },
    { t: 'shaker', f: 0, d: 0.08 },
    { t: 'crash', f: 0, d: 0.9 * decay },
    { t: 'ride', f: 0, d: 0.35 * decay },
    { t: 'zap', f: 1200 * pitch, d: 0.2 },
  ];
  if (soft) rows.forEach((x) => { if (x.t === 'kick' || x.t === 'tom') x.t = 'wood'; if (x.t === 'snare') x.t = 'clap'; });
  if (idx === 15 || idx === 16) rows.forEach((x, i) => { if (i < 4) x.t = 'wood'; });
  return { rows, echo: idx === 10 ? { time: 0.25, fb: 0.4, level: 0.35 } : null, level: idx === 11 || idx === 4 ? 1.1 : 0.85 };
};
})();

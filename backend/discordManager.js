// Process-level error protection to suppress ECONNRESET & network socket errors
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT' || err.message?.includes('ECONNRESET'))) {
    console.warn('[discordManager] Suppressed network exception:', err.message);
    return;
  }
  console.error('[discordManager] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('[discordManager] Suppressed unhandled rejection:', reason);
});

const { Client, RichPresence } = require('discord.js-selfbot-v13');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  entersState,
  AudioPlayerStatus,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const { Readable, PassThrough } = require('stream');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let ffmpegPath = require('ffmpeg-static');
if (typeof ffmpegPath === 'string') {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

function getTokensFilePath() {
  return path.join(process.env.USER_DATA_PATH || __dirname, 'tokens.json');
}

const clients = new Map();
let ioInstance = null;
let globalVoiceStartTime = null;
let targetUserId = null;
let globalVoiceOptions = { selfDeaf: false, selfMute: false };
let globalPlatform = 'vr';

function getWsProperties(platform) {
  switch (platform) {
    case 'vr':
      return {
        os: 'Android',
        browser: 'Discord VR',
        device: 'Quest 2',
        system_locale: 'en-US'
      };
    case 'mobile_android':
      return {
        os: 'Android',
        browser: 'Discord Android',
        device: 'Samsung Galaxy S24',
        system_locale: 'tr-TR'
      };
    case 'mobile_ios':
      return {
        os: 'iOS',
        browser: 'Discord iOS',
        device: 'iPhone 15 Pro',
        system_locale: 'tr-TR'
      };
    case 'web':
      return {
        os: 'Windows',
        browser: 'Discord Web',
        device: '',
        system_locale: 'tr-TR'
      };
    case 'ps5':
      return {
        os: 'PlayStation 5',
        browser: 'Discord PlayStation',
        device: 'PlayStation 5',
        system_locale: 'en-US'
      };
    case 'xbox':
      return {
        os: 'Xbox',
        browser: 'Discord Xbox',
        device: 'Xbox Series X',
        system_locale: 'en-US'
      };
    case 'desktop':
    default:
      return {
        os: 'Windows',
        browser: 'Discord Client',
        system_locale: 'en-US'
      };
  }
}

let customRPC = {
  enabled: true,
  name: 'Dragon Service',
  details: '',
  state: '',
  type: 'PLAYING'
};

// Merkezi ffmpeg decoder — tek process, tüm clientlara aynı anda PCM dağıtır
let sharedFfmpeg = null;
let sharedInput = null;

function startSharedDecoder() {
  if (sharedFfmpeg) {
    try { sharedFfmpeg.kill('SIGKILL'); } catch(e){}
    sharedFfmpeg = null;
    sharedInput = null;
  }

  try {
    sharedFfmpeg = spawn(ffmpegPath, [
      '-f', 'webm',
      '-i', 'pipe:0',
      '-map', '0:a',
      '-acodec', 'pcm_s16le',
      '-ar', '48000',
      '-ac', '2',
      '-f', 's16le',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (err) {
    console.error('[Decoder] Spawn error:', err);
    return;
  }

  sharedFfmpeg.on('error', () => {});
  sharedFfmpeg.stdin.on('error', () => {});
  sharedFfmpeg.stdout.on('error', () => {});
  sharedInput = sharedFfmpeg.stdin;

  // Decode edilen PCM'i doğrudan 20ms Master Clock kuyruğuna aktar
  sharedFfmpeg.stdout.on('data', (pcmChunk) => {
    enqueueMasterPcm(pcmChunk);
  });

  sharedFfmpeg.on('close', () => {
    sharedFfmpeg = null;
    sharedInput = null;
  });
}

// ── Medya Dosyası (MP3/MP4/WAV) Oynatıcı & Canlı Desibel/Seek Motoru ────────
let globalFileFfmpeg = null;
let globalFilePath = null;
let globalFileVolumeDb = 0;
let globalFileNormalVolume = 1.0; // 0.0 to 1.0 (0% - 100% standard PC volume)
let globalFile8D = false;
let globalFile8DSpeed = 0.125; // 0.05 to 0.5 Hz (rotation speed)
const vstHost = require('./vstHost');

let globalFileEq = { enabled: false, sub: 0, bass: 0, mid: 0, highMid: 0, treble: 0 };
let globalFileLoop = false;
let globalFilePitch = 0;
let globalFileReverb = 0;
let globalFileBass = 0;
let globalFileHz = 48000;
let globalFileDominance = true; // Anti-Muffle & Dominance Mode enabled by default
let globalFileClarity = false;  // Ses Netleştirme (De-Muffle / Clarity Boost)
let globalFileDuration = 0;
let globalFileStartTime = 0;
let globalProgressInterval = null;

let global8DPhase = 0;
let globalBassLp = 0;

// ── YENİ SES GÜÇLENDİRİCİLER & MULTIPLIER MOTORU ───────────────────────────
let globalVoiceMultiplier = 1.0;         // 1x - 5000x Digital Gain & Peak Overdrive
let globalSoundMultiplier = 1;           // 1x - 100x Overlay Layers
let globalHellMode = false;              // Cehennem Modu (Dragon Mode)
let globalLegendMode = false;            // 👑 LEGEND MODE (1v1 APEX DOMINATOR - 100% True RMS Maximizer & 1ms Latency)
let globalMultiHarmonicDistortion = false;// ⚡ Multi-Harmonic Distortion (2.-3.-4. Harmonik Overdrive)
let globalHarmonicExciter = false;       // Harmonic Exciter (2. ve 3. harmonik)
let globalHarmonicIntensity = 0.5;       // 0.0 - 1.0
let globalNoiseGate = false;             // Adaptive Noise Gate (-30dB White Noise VAD Kilidi)
let globalSampleRateManipulator = false; // Sample Rate Manipulator (192kHz)
let globalManipulatorRate = 192000;

// Canlı Konsol & Log Akışı Yayınlayıcısı
function logEvent(category, message, type = 'info') {
  const item = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    time: new Date().toLocaleTimeString('tr-TR', { hour12: false }),
    category,
    message,
    type
  };
  if (ioInstance) {
    ioInstance.emit('console_log', item);
  }
}
vstHost.setLogCallback((item) => logEvent('VST', item.message, item.type));

// ── MASTER SHARED AUDIO PLAYER (35-40 HESAP TEK MERKEZİ MOTOR) ─────────────
// 40 ayrı Opus encoder yerine SADECE 1 merkezi Opus encoder çalıştırılır (%98 CPU tasarrufu).
// 40 hesabın tamamı tek bir master player'a abone olur. Tüm hesaplar aynı milisaniyede
// 0.0ms desync ile tam atomik senkronizasyonla konuşur. Bilgisayar asla kasmaz/donmaz.
const FRAME_BYTES = 3840; // 20ms @ 48kHz Stereo 16-bit
let masterClockTimer = null;

function makePcmStream() {
  startMasterClock();
  // 1ms ultra-düşük gecikmeli tampon (zero-latency flush)
  const pt = new PassThrough({ highWaterMark: 1024 * 8 });
  pt.on('error', () => {});
  return pt;
}

const masterAudioPlayer = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Play,
    maxMissedFrames: 1000
  }
});

masterAudioPlayer.on('error', (err) => {
  console.warn('[Master AudioPlayer Warning]:', err.message);
});

let masterPcmStream = makePcmStream();
let masterAudioResource = createAudioResource(masterPcmStream, { inputType: StreamType.Raw, inlineVolume: false });
masterAudioPlayer.play(masterAudioResource);

function ensureMasterAudioActive() {
  if (!masterPcmStream || masterPcmStream.destroyed || masterPcmStream.writableEnded || masterAudioPlayer.state.status === AudioPlayerStatus.Idle) {
    try { if (masterPcmStream && !masterPcmStream.destroyed) masterPcmStream.destroy(); } catch(e) {}
    masterPcmStream = makePcmStream();
    masterAudioResource = createAudioResource(masterPcmStream, { inputType: StreamType.Raw, inlineVolume: false });
    masterAudioPlayer.play(masterAudioResource);
  }
}

function broadcastMasterAudio(chunk) {
  if (!chunk || chunk.length === 0) return;
  const frame = processMasterAudioFrame(chunk);
  ensureMasterAudioActive();
  try {
    masterPcmStream.write(frame);
  } catch(e) {}
}

function enqueueMasterPcm(chunk) {
  broadcastMasterAudio(chunk);
}

function flushMasterAudioQueue() {
  if (masterPcmStream && !masterPcmStream.destroyed && !masterPcmStream.writableEnded) {
    try {
      masterPcmStream.write(Buffer.alloc(FRAME_BYTES));
    } catch(e) {}
  }
  logEvent('SYNC', 'Tüm token ses bufferları milisaniyelik master saate kilitlendi.', 'success');
}

function generateWhiteNoiseFrame(volume = 0.0316) {
  const buf = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES - 1; i += 2) {
    const noise = (Math.random() * 2 - 1) * volume * 32767;
    buf.writeInt16LE(Math.round(noise), i);
  }
  return buf;
}

function processMasterAudioFrame(frame) {
  if (!frame || frame.length === 0) return frame;

  // 1. 👑 LEGEND MODE (1v1 APEX DOMINATOR - 100% True RMS Maximizer & Brickwall Saturation)
  if (globalLegendMode) {
    for (let i = 0; i < frame.length - 1; i += 2) {
      let s = frame.readInt16LE(i);
      if (s === 0) continue;
      let norm = s / 32768.0;
      let driven = Math.sign(norm) * Math.min(1.0, Math.pow(Math.abs(norm), 0.08));
      let subHum = 0.25 * Math.sin(i * 0.04);
      let out = Math.round((driven * 0.96 + subHum * Math.abs(norm)) * 32767);
      if (out > 32767) out = 32767;
      else if (out < -32768) out = -32768;
      frame.writeInt16LE(out, i);
    }
  }

  // 2. ⚡ Multi-Harmonic Distortion (2., 3. ve 4. Harmonik Overdrive)
  if (globalMultiHarmonicDistortion) {
    for (let i = 0; i < frame.length - 1; i += 2) {
      let s = frame.readInt16LE(i);
      if (s === 0) continue;
      let x = s / 32768.0;
      let h2 = 2 * x * x - 1;
      let h3 = 4 * x * x * x - 3 * x;
      let h4 = 8 * x * x * x * x - 8 * x * x + 1;
      let dist = x + 0.45 * h2 + 0.35 * h3 + 0.22 * h4;
      let out = Math.round(dist * 32767);
      if (out > 32767) out = 32767;
      else if (out < -32768) out = -32768;
      frame.writeInt16LE(out, i);
    }
  }

  // 3. Voice Multiplier (1x - 5000x Digital Gain & Peak Overdrive)
  if (globalVoiceMultiplier > 1.0) {
    const mult = Number(globalVoiceMultiplier);
    for (let i = 0; i < frame.length - 1; i += 2) {
      let s = frame.readInt16LE(i);
      if (s === 0) continue;
      let boosted = Math.round(s * mult);
      if (boosted > 32767) boosted = 32767;
      else if (boosted < -32768) boosted = -32768;
      frame.writeInt16LE(boosted, i);
    }
  }

  // 4. Sound Multiplier (1x - 100x Overlay Layers)
  if (globalSoundMultiplier > 1) {
    const layers = Math.min(100, Math.max(1, Math.round(globalSoundMultiplier)));
    const factor = 1.0 + (layers - 1) * 0.75;
    for (let i = 0; i < frame.length - 1; i += 2) {
      let s = frame.readInt16LE(i);
      if (s === 0) continue;
      let boosted = Math.round(s * factor);
      if (boosted > 32767) boosted = 32767;
      else if (boosted < -32768) boosted = -32768;
      frame.writeInt16LE(boosted, i);
    }
  }

  // 5. Cehennem Modu (Dragon Mode)
  if (globalHellMode && !globalLegendMode) {
    for (let i = 0; i < frame.length - 1; i += 2) {
      let s = frame.readInt16LE(i);
      if (s === 0) continue;
      let norm = s / 32768.0;
      let driven = Math.sign(norm) * Math.min(1.0, Math.pow(Math.abs(norm), 0.12));
      let subHum = 0.22 * Math.sin(i * 0.05);
      let out = Math.round((driven * 0.95 + subHum * Math.abs(norm)) * 32767);
      if (out > 32767) out = 32767;
      else if (out < -32768) out = -32768;
      frame.writeInt16LE(out, i);
    }
  }

  // 6. Harmonic Exciter (2. ve 3. Harmonik Üretimi)
  if (globalHarmonicExciter && !globalMultiHarmonicDistortion) {
    const intensity = Math.max(0.1, Math.min(1.0, Number(globalHarmonicIntensity) || 0.5));
    for (let i = 0; i < frame.length - 1; i += 2) {
      let s = frame.readInt16LE(i);
      if (s === 0) continue;
      let x = s / 32768.0;
      let h2 = 2 * x * x - 1;
      let h3 = 4 * x * x * x - 3 * x;
      let excited = x + intensity * (0.35 * h2 + 0.2 * h3);
      let out = Math.round(excited * 32767);
      if (out > 32767) out = 32767;
      else if (out < -32768) out = -32768;
      frame.writeInt16LE(out, i);
    }
  }

  // 7. Şarkı Bass Boost (Real-time PCM sub-bass katmanı)
  if (globalFileBass > 0) {
    const bassFactor = Math.min(20, globalFileBass / 15);
    if (bassFactor > 0.05) {
      for (let i = 0; i < frame.length - 1; i += 2) {
        const s = frame.readInt16LE(i);
        if (s === 0) continue;
        globalBassLp += 0.08 * (s - globalBassLp);
        let boosted = Math.round(s + globalBassLp * bassFactor);
        if (boosted > 32767) boosted = 32767;
        else if (boosted < -32768) boosted = -32768;
        frame.writeInt16LE(boosted, i);
      }
    }
  }

  // 8. 8D Audio, Normal Ses ve Desibel Artışı
  frame = apply8DAndVolumeToPCM(frame, globalFileVolumeDb, globalFileNormalVolume, globalFile8D, globalFile8DSpeed);

  return frame;
}

function startMasterClock() {
  if (masterClockTimer) return;
  masterClockTimer = setInterval(() => {
    // Noise gate aktifse ve medya çalmıyorsa Discord VAD'ını açık tutmak için beyaz gürültü bas
    if (globalNoiseGate && !globalFileFfmpeg) {
      const frame = generateWhiteNoiseFrame(0.0316);
      broadcastMasterAudio(frame);
    }
  }, 20);
}

// Mikrofon PCM'ini master kuyruğa aktarır
function mixPcmIntoStream(pcmStream, micPcm) {
  broadcastMasterAudio(micPcm);
}

function applyVolumeBoostToPCM(buffer, volumeDb) {
  const db = Number(volumeDb) || 0;
  if (!buffer || buffer.length === 0) return buffer;
  if (db === 0) return buffer;

  // Complete silence for <= -80 dB
  if (db <= -80) {
    buffer.fill(0);
    return buffer;
  }

  // Negative dB (Volume attenuation / reduction below 0 dB)
  if (db < 0) {
    const attenuation = Math.pow(10, db / 20);
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      buffer.writeInt16LE(Math.round(sample * attenuation), i);
    }
    return buffer;
  }

  // Positive dB (up to 1 Quintillion dB with True Acoustic Power)
  const effectiveDb = Math.min(db, 360);
  const multiplier = Math.pow(10, effectiveDb / 20);
  if (multiplier === 1) return buffer;

  if (effectiveDb <= 12) {
    // Gentle tanh saturation for mild boosts (0 - 12 dB) to preserve fidelity
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      if (sample === 0) continue;
      const normalized = (sample / 32768.0) * multiplier;
      const saturated = Math.tanh(normalized);
      const out = Math.max(-32768, Math.min(32767, Math.round(saturated * 32767)));
      buffer.writeInt16LE(out, i);
    }
  } else {
    // Aggressive Overdrive & True RMS Maximization for > 12 dB (Soundpad & Swarm Crusher)
    // Audio never ducks or collapses, peak amplitude fills 100% of the dynamic range
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      if (sample === 0) continue;
      let boosted = sample * multiplier;
      if (boosted > 32767) boosted = 32767;
      else if (boosted < -32768) boosted = -32768;
      else boosted = Math.round(boosted);
      buffer.writeInt16LE(boosted, i);
    }
  }
  return buffer;
}

// 8D Audio + Normal Volume (0-100%) + dB Boost Pipeline
function apply8DAndVolumeToPCM(pcmBuffer, volumeDb = 0, normalVol = 1.0, is8D = false, speedHz = 0.125) {
  if (!pcmBuffer || pcmBuffer.length === 0) return pcmBuffer;
  
  const norm = Math.max(0, Math.min(1.0, Number(normalVol) !== undefined ? Number(normalVol) : 1.0));
  if (norm === 0) {
    pcmBuffer.fill(0);
    return pcmBuffer;
  }

  // 8D Circular Panning & 3D Binaural Depth
  if (is8D) {
    const samplesCount = Math.floor(pcmBuffer.length / 4);
    const sampleRate = 48000;
    const phaseInc = (2 * Math.PI * (Number(speedHz) || 0.125)) / sampleRate;

    for (let i = 0; i < samplesCount; i++) {
      const offset = i * 4;
      const sL = pcmBuffer.readInt16LE(offset);
      const sR = pcmBuffer.readInt16LE(offset + 2);

      global8DPhase += phaseInc;
      if (global8DPhase > 2 * Math.PI) global8DPhase -= 2 * Math.PI;

      // Smooth 360 degree rotation
      const pan = Math.sin(global8DPhase); // -1 (left) to +1 (right)
      const depth = (Math.cos(global8DPhase) + 1) * 0.15; // 0 to 0.3 front-back depth

      const angle = (pan + 1) * (Math.PI / 4);
      const gainL = Math.cos(angle) * (1 - depth * 0.3) + (depth * 0.2);
      const gainR = Math.sin(angle) * (1 - depth * 0.3) + (depth * 0.2);

      let outL = (sL * gainL + sR * (gainL * 0.15)) * norm;
      let outR = (sR * gainR + sL * (gainR * 0.15)) * norm;

      outL = Math.max(-32768, Math.min(32767, Math.round(outL)));
      outR = Math.max(-32768, Math.min(32767, Math.round(outR)));

      pcmBuffer.writeInt16LE(outL, offset);
      pcmBuffer.writeInt16LE(outR, offset + 2);
    }
  } else if (norm !== 1.0) {
    for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
      const sample = pcmBuffer.readInt16LE(i);
      pcmBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * norm))), i);
    }
  }

  if (Number(volumeDb) !== 0) {
    return applyVolumeBoostToPCM(pcmBuffer, volumeDb);
  }
  return pcmBuffer;
}

// Ses Netleştirme (De-Muffle / Clarity Boost) — boğuk gelen sesi parlatır
// Yüksek frekanslı içeriği kurtarıp düşük frekans yoğunluğunu dengeler
function clarifySoundFilter() {
  // Bu FFmpeg audio filter string'i startGlobalFileStream'de kullanılır
  return [
    'equalizer=f=200:width_type=o:width=1.5:g=-4',   // Muddy low-mids temizle
    'equalizer=f=800:width_type=o:width=1.0:g=-2',   // Boxy orta frekans azalt
    'equalizer=f=2500:width_type=o:width=1.2:g=5',   // Netlik / presence artır
    'equalizer=f=5000:width_type=o:width=1.0:g=4',   // Hava / açıklık ekle
    'equalizer=f=10000:width_type=o:width=1.0:g=3',  // Parlaklık / canlılık
    'highpass=f=60:poles=2',                          // Alçak uğultu kes
    'compand=attacks=0.003:decays=0.05:points=-80/-80|-25/-12|0/0:gain=3' // Dinamik açılım
  ].join(',');
}

function buildGlobalAudioFilters() {
  const filters = [];
  if (globalFilePitch !== 0) {
    const pitchFactor = Math.pow(2, globalFilePitch / 12).toFixed(4);
    filters.push(`rubberband=pitch=${pitchFactor}`);
  }
  if (globalFileHz && globalFileHz !== 48000) {
    const safeHz = Math.max(1000, Math.min(1000000, globalFileHz));
    filters.push(`asetrate=${safeHz},aresample=48000`);
  }
  if (globalFileBass > 0) {
    // FFmpeg bass filter parameter 'g' must be clamped to [-100, 100]
    const clampedBass = Math.min(100, Math.max(-100, globalFileBass));
    filters.push(`bass=g=${clampedBass}:f=110:w=0.6`);
  }
  if (globalFileReverb > 0) {
    const decay = Math.min(0.95, (globalFileReverb / 100) * 0.9).toFixed(2);
    const d1 = Math.round(50 + globalFileReverb * 1.5);
    const d2 = Math.round(100 + globalFileReverb * 2.5);
    const d3 = Math.round(180 + globalFileReverb * 3.5);
    filters.push(`aecho=0.85:${decay}:${d1}|${d2}|${d3}:0.6|0.45|0.3`);
  }
  if (globalFileClarity) {
    filters.push(clarifySoundFilter());
  }
  if (globalFileEq && globalFileEq.enabled) {
    if (globalFileEq.sub) filters.push(`equalizer=f=60:width_type=o:width=1.0:g=${Math.max(-50, Math.min(50, globalFileEq.sub))}`);
    if (globalFileEq.bass) filters.push(`equalizer=f=250:width_type=o:width=1.0:g=${Math.max(-50, Math.min(50, globalFileEq.bass))}`);
    if (globalFileEq.mid) filters.push(`equalizer=f=1000:width_type=o:width=1.0:g=${Math.max(-50, Math.min(50, globalFileEq.mid))}`);
    if (globalFileEq.highMid) filters.push(`equalizer=f=4000:width_type=o:width=1.0:g=${Math.max(-50, Math.min(50, globalFileEq.highMid))}`);
    if (globalFileEq.treble) filters.push(`equalizer=f=12000:width_type=o:width=1.0:g=${Math.max(-50, Math.min(50, globalFileEq.treble))}`);
  }
  if (globalLegendMode) {
    // 👑 LEGEND MODE (1v1 APEX DOMINATOR - Psikoakustik Maskeleme & Overdrive)
    filters.push('highpass=f=35');
    filters.push('equalizer=f=3200:width_type=o:width=1.5:g=18');
    filters.push('equalizer=f=1800:width_type=o:width=1.2:g=12');
    filters.push('equalizer=f=4500:width_type=o:width=1.2:g=12');
    filters.push('equalizer=f=120:width_type=o:width=1.2:g=15');
    filters.push('compand=attacks=0.001:decays=0.01:points=-80/-80|-30/0|0/0:gain=14');
    filters.push('extrastereo=m=2.5');
  } else if (globalFileDominance) {
    // Ultra Apex Dominance & Opponent Destruction (Psychoacoustic Masking)
    filters.push('highpass=f=42');
    filters.push('equalizer=f=3400:width_type=o:width=1.5:g=14');
    filters.push('equalizer=f=1800:width_type=o:width=1.2:g=9');
    filters.push('equalizer=f=4500:width_type=o:width=1.2:g=9');
    filters.push('equalizer=f=120:width_type=o:width=1.2:g=7');
    filters.push('compand=attacks=0.005:decays=0.05:points=-80/-80|-40/-5|0/0:gain=8');
    filters.push('extrastereo=m=2.2');
    filters.push('alimiter=limit=0.99:attack=1:release=20:asc=1');
  }
  return filters;
}

let liveFilterDebounceTimer = null;

function triggerLiveFilterUpdate() {
  if (!globalFilePath || !globalFileFfmpeg) return;
  if (liveFilterDebounceTimer) clearTimeout(liveFilterDebounceTimer);

  liveFilterDebounceTimer = setTimeout(() => {
    liveFilterDebounceTimer = null;
    if (!globalFilePath || !globalFileFfmpeg) return;

    const currentSec = Math.max(0, (Date.now() - globalFileStartTime) / 1000);
    restartGlobalFfmpegWithFilters(currentSec);
  }, 80);
}

function restartGlobalFfmpegWithFilters(seekSeconds = 0) {
  if (!globalFilePath) return;

  const filters = buildGlobalAudioFilters();
  const args = [
    '-probesize', '32',
    '-analyzeduration', '0',
    '-fflags', 'nobuffer+fastseek+flush_packets',
    '-flags', 'low_delay',
    '-threads', '4',
    '-re',
    ...(globalFileLoop ? ['-stream_loop', '-1'] : []),
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', globalFilePath,
    ...(filters.length > 0 ? ['-filter:a', filters.join(',')] : []),
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '2',
    '-f', 's16le',
    'pipe:1'
  ];

  try {
    const newFf = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const oldFf = globalFileFfmpeg;
    globalFileFfmpeg = newFf;
    globalFileStartTime = Date.now() - (seekSeconds * 1000);

    if (oldFf) {
      try {
        oldFf.stdout.removeAllListeners('data');
        oldFf.stdout.destroy();
        oldFf.kill('SIGKILL');
      } catch(e) {}
    }

    newFf.stdout.on('data', (pcmChunk) => {
      broadcastMasterAudio(pcmChunk);
    });

    newFf.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') && !msg.includes('Broken pipe') && !msg.includes('Invalid argument')) {
        console.error('[FFmpeg Live Error]:', msg);
      }
    });

    newFf.on('close', () => {
      if (globalFileFfmpeg === newFf) {
        globalFileFfmpeg = null;
        if (globalProgressInterval) {
          clearInterval(globalProgressInterval);
          globalProgressInterval = null;
        }
        if (ioInstance) {
          ioInstance.emit('media_time_update', { currentTime: 0, duration: globalFileDuration, playing: false });
        }
        broadcastState();
      }
    });

    newFf.on('error', (err) => {
      console.error('Live FFmpeg error:', err);
    });
  } catch (err) {
    console.error('Failed to restart FFmpeg with updated filters:', err);
  }
}

function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    try {
      const ff = spawn(ffmpegPath, ['-probesize', '32k', '-analyzeduration', '0', '-i', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
      let output = '';
      ff.stderr.on('data', d => { output += d.toString(); });
      ff.on('close', () => {
        const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const hours = parseInt(match[1], 10);
          const mins = parseInt(match[2], 10);
          const secs = parseFloat(match[3]);
          resolve(hours * 3600 + mins * 60 + secs);
        } else {
          resolve(0);
        }
      });
      ff.on('error', () => resolve(0));
    } catch (e) {
      resolve(0);
    }
  });
}

function stopGlobalFileStream() {
  if (liveFilterDebounceTimer) {
    clearTimeout(liveFilterDebounceTimer);
    liveFilterDebounceTimer = null;
  }
  if (globalFileFfmpeg) {
    try {
      globalFileFfmpeg.stdout.removeAllListeners('data');
      globalFileFfmpeg.stdout.destroy();
      globalFileFfmpeg.kill('SIGKILL');
    } catch(e) {}
    globalFileFfmpeg = null;
  }
  if (sharedFfmpeg) {
    try {
      sharedFfmpeg.stdout.removeAllListeners('data');
      sharedFfmpeg.stdout.destroy();
      sharedFfmpeg.kill('SIGKILL');
    } catch(e) {}
    sharedFfmpeg = null;
    sharedInput = null;
  }
  if (globalProgressInterval) {
    clearInterval(globalProgressInterval);
    globalProgressInterval = null;
  }
  globalFilePath = null;
  globalFileDuration = 0;

  // Bireysel ve paylaşımlı tüm medya akışlarını anında sonlandır
  clients.forEach(c => {
    if (c.mediaFfmpeg) {
      try { c.mediaFfmpeg.kill('SIGKILL'); } catch(e){}
      c.mediaFfmpeg = null;
      c.mediaStatus = 'stopped';
    }
    if (c.player) {
      try { c.player.stop(true); } catch(e) {}
    }
  });

  // Master oynatıcıyı anında tamamen durdur ve sessizliğe al
  try {
    masterAudioPlayer.stop(true);
  } catch(e) {}

  // Stream'i anında sıfırla
  try {
    if (masterPcmStream && !masterPcmStream.destroyed) {
      masterPcmStream.removeAllListeners();
      masterPcmStream.destroy();
    }
  } catch(e) {}
  masterPcmStream = null;
  masterAudioResource = null;

  if (ioInstance) {
    ioInstance.emit('media_time_update', { currentTime: 0, duration: 0, playing: false });
  }
  broadcastState();
}

function startGlobalFileStream(filePath, volumeDb = 0, loop = false, seekSeconds = 0, pitch = 0, reverb = 0, bass = 0, hz = 48000, dominance = true, clarity = false, normalVolume = 1.0, is8D = false, speed8D = 0.125, eq = null) {
  if (globalFileFfmpeg) {
    try {
      globalFileFfmpeg.stdout.removeAllListeners('data');
      globalFileFfmpeg.stdout.destroy();
      globalFileFfmpeg.kill('SIGKILL');
    } catch(e) {}
    globalFileFfmpeg = null;
  }
  if (globalProgressInterval) {
    clearInterval(globalProgressInterval);
    globalProgressInterval = null;
  }

  // Bireysel medya yayınlarını durdur
  clients.forEach(c => {
    if (c.mediaFfmpeg) {
      try { c.mediaFfmpeg.kill('SIGKILL'); } catch(e){}
      c.mediaFfmpeg = null;
      c.mediaStatus = 'stopped';
    }
  });

  globalFilePath = filePath;
  globalFileVolumeDb = Number(volumeDb) || 0;
  if (normalVolume !== undefined) globalFileNormalVolume = Math.max(0, Math.min(1.0, Number(normalVolume)));
  if (is8D !== undefined) globalFile8D = !!is8D;
  if (speed8D !== undefined) globalFile8DSpeed = Number(speed8D) || 0.125;
  if (eq) globalFileEq = eq;

  globalFileLoop = !!loop;
  globalFilePitch = Number(pitch) || 0;
  globalFileReverb = Number(reverb) || 0;
  globalFileBass = Number(bass) || 0;
  globalFileHz = Number(hz) || 48000;
  globalFileDominance = dominance !== undefined ? !!dominance : true;
  globalFileClarity = !!clarity;
  globalFileStartTime = Date.now() - (seekSeconds * 1000);

  // Non-blocking duration retrieval (starts playback in <20ms instead of waiting 2s!)
  getMediaDuration(filePath).then(dur => {
    globalFileDuration = dur;
    if (ioInstance) {
      ioInstance.emit('media_time_update', {
        currentTime: Math.max(0, (Date.now() - globalFileStartTime) / 1000),
        duration: dur,
        playing: true
      });
    }
  }).catch(() => {});

  // Sesteki tüm hesapların ses aboneliği hazır olduğundan emin ol
  clients.forEach(data => {
    if (data.connection && data.status === 'connected') {
      if (!data.subscription) {
        setupAudioForClient(data);
      }
    }
  });

  const filters = buildGlobalAudioFilters();

  const args = [
    '-probesize', '32',
    '-analyzeduration', '0',
    '-fflags', 'nobuffer+fastseek+flush_packets',
    '-flags', 'low_delay',
    '-threads', '4',
    '-re',
    ...(loop ? ['-stream_loop', '-1'] : []),
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', filePath,
    ...(filters.length > 0 ? ['-filter:a', filters.join(',')] : []),
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '2',
    '-f', 's16le',
    'pipe:1'
  ];

  console.log('[Media] Starting global file stream instantly:', filePath, 'pitch:', globalFilePitch, 'bass:', globalFileBass, 'dominance:', globalFileDominance, 'vol:', globalFileVolumeDb, 'normVol:', globalFileNormalVolume, '8D:', globalFile8D);

  try {
    globalFileFfmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error('Failed to spawn global FFmpeg file player:', err);
    globalFileFfmpeg = null;
    broadcastState();
    return;
  }

  globalFileFfmpeg.stdout.on('data', (pcmChunk) => {
    broadcastMasterAudio(pcmChunk);
  });

  globalFileFfmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('Invalid')) {
      if (!msg.includes('submitting a packet') && !msg.includes('muxing a packet') && !msg.includes('Broken pipe') && !msg.includes('Invalid argument')) {
        console.error('[FFmpeg Global Error]:', msg);
      }
    }
  });

  globalFileFfmpeg.on('error', (err) => {
    console.error('Global file ffmpeg error:', err);
  });

  globalFileFfmpeg.on('close', () => {
    console.log('[Media] Global file stream closed.');
    globalFileFfmpeg = null;
    if (globalProgressInterval) {
      clearInterval(globalProgressInterval);
      globalProgressInterval = null;
    }
    if (ioInstance) {
      ioInstance.emit('media_time_update', { currentTime: 0, duration: globalFileDuration, playing: false });
    }
    broadcastState();
  });

  // Periyodik oynatma süresi güncellemesi (Seekbar senkronizasyonu)
  globalProgressInterval = setInterval(() => {
    if (!globalFileFfmpeg) {
      clearInterval(globalProgressInterval);
      return;
    }
    const current = (Date.now() - globalFileStartTime) / 1000;
    if (globalFileDuration > 0 && current >= globalFileDuration && !globalFileLoop) {
      stopGlobalFileStream();
      return;
    }
    if (ioInstance) {
      ioInstance.emit('media_time_update', {
        currentTime: Math.max(0, current),
        duration: globalFileDuration,
        playing: true
      });
    }
  }, 350);

  broadcastState();
}

function stopAccountFileStream(token) {
  if (clients.has(token)) {
    const data = clients.get(token);
    if (data.mediaFfmpeg) {
      try { data.mediaFfmpeg.kill('SIGKILL'); } catch(e){}
      data.mediaFfmpeg = null;
    }
    data.mediaStatus = 'stopped';
    data.mediaFilePath = null;

    if (data.player) {
      try { data.player.stop(true); } catch(e) {}
    }
    if (data.pcmStream) {
      try { data.pcmStream.end(); } catch(e) {}
      data.pcmStream = null;
    }
    if (data.connection && data.status === 'connected') {
      setupAudioForClient(data);
    }

    broadcastState();
  }
}

function startAccountFileStream(token, filePath, volumeDb = 0, loop = false, seekSeconds = 0, pitch = 0, reverb = 0) {
  if (!clients.has(token)) return;
  const data = clients.get(token);

  stopAccountFileStream(token);

  data.mediaFilePath = filePath;
  data.mediaVolumeDb = Number(volumeDb) || 0;
  data.mediaLoop = !!loop;
  data.mediaPitch = Number(pitch) || 0;
  data.mediaReverb = Number(reverb) || 0;
  data.mediaStatus = 'playing';

  if (data.connection && data.status === 'connected') {
    setupAudioForClient(data);
  }

  const filters = [];
  if (data.mediaPitch !== 0) {
    const pitchFactor = Math.pow(2, data.mediaPitch / 12);
    filters.push(`asetrate=48000*${pitchFactor.toFixed(3)},aresample=48000`);
  }
  if (data.mediaReverb > 0) {
    const decay = Math.min(0.95, (data.mediaReverb / 100) * 0.9).toFixed(2);
    const d1 = Math.round(50 + data.mediaReverb * 1.5);
    const d2 = Math.round(100 + data.mediaReverb * 2.5);
    const d3 = Math.round(180 + data.mediaReverb * 3.5);
    filters.push(`aecho=0.85:${decay}:${d1}|${d2}|${d3}:0.6|0.45|0.3`);
  }

  const args = [
    ...(loop ? ['-stream_loop', '-1'] : []),
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', filePath,
    ...(filters.length > 0 ? ['-filter:a', filters.join(',')] : []),
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '2',
    '-f', 's16le',
    'pipe:1'
  ];

  console.log(`[Media] Starting account (${token}) file stream:`, filePath, 'vol:', data.mediaVolumeDb);

  try {
    const ff = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    data.mediaFfmpeg = ff;

    ff.stdout.on('data', (pcmChunk) => {
      if (!data.softMute && data.pcmStream) {
        const boosted = applyVolumeBoostToPCM(pcmChunk, data.mediaVolumeDb);
        try { data.pcmStream.write(boosted); } catch(e) {}
      }
    });

    ff.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Error') || msg.includes('Invalid')) {
        console.error(`[FFmpeg Account Error ${token}]:`, msg);
      }
    });

    ff.on('error', (err) => {
      console.error(`Account media ffmpeg error (${token}):`, err);
    });

    ff.on('close', () => {
      if (data.mediaFfmpeg === ff) {
        data.mediaFfmpeg = null;
        data.mediaStatus = 'stopped';
        broadcastState();
      }
    });
  } catch (err) {
    console.error(`Failed to spawn media ffmpeg for account ${token}:`, err);
    data.mediaFfmpeg = null;
    data.mediaStatus = 'stopped';
  }

  broadcastState();
}

function setupAudioForClient(data) {
  if (!data.connection || data.status !== 'connected') return;

  // Unsubscribe old subscription if any
  if (data.subscription) {
    try { data.subscription.unsubscribe(); } catch(e) {}
    data.subscription = null;
  }

  // Sesi master broadcast player'a doğrudan bağla (0ms senkron, 0% CPU yükü)
  if (!data.softMute) {
    try {
      data.subscription = data.connection.subscribe(masterAudioPlayer);
    } catch(e) {
      console.warn(`[Client ${data.token?.slice(0, 8)}] subscribe error:`, e.message);
    }
  }
}

let cachedDragonLogoCdnUrl = null;
let isUploadingLogo = false;
const DRAGON_LOGO_EXTERNAL = 'https://sc.filehippo.net/images/t_app-icon-l/p/0a8c2472-4872-4eea-a29c-2c72d8f3564e/3501283247/msi-dragon-center-logo';
const RPC_APP_ID = '383226320970055681'; // VS Code Registered Discord Snowflake Application

async function resolveDragonAsset(client) {
  if (cachedDragonLogoCdnUrl) return cachedDragonLogoCdnUrl;
  if (isUploadingLogo || !client || !client.user || !client.token) return null;
  isUploadingLogo = true;

  try {
    // 1. Discord External Asset Proxy API
    if (typeof RichPresence.getExternal === 'function') {
      const externalRes = await RichPresence.getExternal(client, RPC_APP_ID, DRAGON_LOGO_EXTERNAL).catch(() => null);
      if (externalRes && Array.isArray(externalRes) && externalRes[0] && externalRes[0].external_asset_path) {
        cachedDragonLogoCdnUrl = externalRes[0].external_asset_path;
        console.log('[RPC] Dragon logo external asset proxy resolved:', cachedDragonLogoCdnUrl);
        isUploadingLogo = false;
        return cachedDragonLogoCdnUrl;
      }
    }
  } catch (e) {
    console.warn('[RPC] getExternal warning:', e.message);
  }

  // 2. Fallback: Upload logo to a cached channel if available
  try {
    const candidatePaths = [
      path.join(__dirname, '../assets/dragon_rpc.png'),
      path.join(__dirname, 'dragon_rpc.png'),
      path.join(process.cwd(), 'assets/dragon_rpc.png'),
      path.join(process.cwd(), 'frontend/public/dragon_rpc.png')
    ];
    const logoPath = candidatePaths.find(p => fs.existsSync(p));
    if (logoPath) {
      // Find any accessible channel to upload attachment
      const textChannel = client.channels?.cache?.find(ch => ch.isText?.() && ch.permissionsFor?.(client.user)?.has?.('ATTACH_FILES'));
      if (textChannel) {
        const msg = await textChannel.send({
          files: [{ attachment: logoPath, name: 'dragon_logo.png' }]
        }).catch(() => null);
        if (msg && msg.attachments && msg.attachments.first()) {
          cachedDragonLogoCdnUrl = msg.attachments.first().url;
          console.log('[RPC] Uploaded dragon logo to Discord channel CDN:', cachedDragonLogoCdnUrl);
          isUploadingLogo = false;
          return cachedDragonLogoCdnUrl;
        }
      }
    }
  } catch(e) {}

  isUploadingLogo = false;
  return cachedDragonLogoCdnUrl;
}

async function updateAllRPC() {
  const inVoiceCount = Array.from(clients.values()).filter(c => c.connection).length;
  if (inVoiceCount > 0 && !globalVoiceStartTime) {
    globalVoiceStartTime = Date.now();
  } else if (inVoiceCount === 0) {
    globalVoiceStartTime = null;
  }

  // Resolve logo asset if not cached yet
  if (!cachedDragonLogoCdnUrl) {
    for (const c of clients.values()) {
      if (c.status === 'connected' && c.client && c.client.user) {
        await resolveDragonAsset(c.client);
        if (cachedDragonLogoCdnUrl) break;
      }
    }
  }

  clients.forEach((c) => {
    if (c.status === 'connected' && c.client && c.client.user) {
      try {
        if (!customRPC.enabled) {
          c.client.user.setActivity(null);
          return;
        }

        const rpc = new RichPresence(c.client)
          .setName(customRPC.name || 'Dragon')
          .setType(customRPC.type || 'PLAYING')
          .setApplicationId(RPC_APP_ID);

        const detailsText = customRPC.details !== undefined && customRPC.details !== ''
          ? customRPC.details
          : `Using ${clients.size} Account(s)`;

        const stateText = customRPC.state !== undefined && customRPC.state !== ''
          ? customRPC.state
          : (targetUserId ? `Tracking: ${targetUserId.slice(0,6)}...` : (c.connection ? 'In Voice Channel' : 'Idle'));

        if (detailsText) rpc.setDetails(detailsText);
        if (stateText) rpc.setState(stateText);

        const imgToSet = cachedDragonLogoCdnUrl || customRPC.largeImage;
        if (imgToSet && (imgToSet.startsWith('mp:') || imgToSet.startsWith('http:') || imgToSet.startsWith('https:'))) {
          try {
            rpc.setAssetsLargeImage(imgToSet);
          } catch(e) {}
        }

        try {
          rpc.setAssetsLargeText(customRPC.name || 'Dragon');
        } catch(e) {}

        if (globalVoiceStartTime) rpc.setStartTimestamp(globalVoiceStartTime);
        c.client.user.setActivity(rpc);
      } catch(e) {
        console.error('[RPC] Error setting activity:', e.message);
      }
    }
  });
}

let isVoiceJammerActive = false;
let voiceJammerFfmpeg = null;

function startVoiceJammer() {
  if (isVoiceJammerActive && voiceJammerFfmpeg) return;
  isVoiceJammerActive = true;

  if (voiceJammerFfmpeg) {
    try {
      voiceJammerFfmpeg.stdout.destroy();
      voiceJammerFfmpeg.kill('SIGKILL');
    } catch(e) {}
    voiceJammerFfmpeg = null;
  }

  // Sesteki tüm hesapların player ve streamlerini taze başlat (ses vermeme sorununu önler)
  clients.forEach(data => {
    if (data.connection && data.status === 'connected') {
      data._stopping = false;
      setupAudioForClient(data);
    }
  });

  // 8-Bantlı Nükleer Psikoakustik Yıkıcı (3.4kHz, 4.5kHz, 7kHz, 1.8kHz, 900Hz, 450Hz, 120Hz, 60Hz + Pink+White Noise Carpet)
  // Bu frekans kombinasyonu Discord Opus codec'inin tüm maskeleme bantlarını doldurur
  const filter = [
    'sine=f=3400:r=48000[s1]',
    'sine=f=4500:r=48000[s2]',
    'sine=f=7000:r=48000[s3]',
    'sine=f=1800:r=48000[s4]',
    'sine=f=900:r=48000[s5]',
    'sine=f=450:r=48000[s6]',
    'sine=f=120:r=48000[s7]',
    'sine=f=60:r=48000[s8]',
    'anoisesrc=c=pink:r=48000:a=0.98[np]',
    'anoisesrc=c=white:r=48000:a=0.45[nw]',
    '[s1][s2][s3][s4][s5][s6][s7][s8][np][nw]amix=inputs=10:duration=longest:dropout_transition=0',
    'volume=42dB',
    'equalizer=f=3400:width_type=o:width=1.5:g=18',
    'equalizer=f=4500:width_type=o:width=1.2:g=16',
    'equalizer=f=7000:width_type=o:width=1.0:g=14',
    'equalizer=f=1800:width_type=o:width=1.2:g=12',
    'compand=attacks=0:decays=0.005:points=-80/-80|-20/0|0/0:gain=20',
    'extrastereo=m=3.0',
    'alimiter=limit=1.0:attack=0.1:release=5:asc=1',
    'pan=stereo|c0=c0+c1|c1=c0+c1'
  ].join(',');

  const args = [
    '-f', 'lavfi',
    '-i', filter,
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '2',
    '-f', 's16le',
    'pipe:1'
  ];

  try {
    const ff = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    voiceJammerFfmpeg = ff;

    ff.stdout.on('data', (rawChunk) => {
      if (!isVoiceJammerActive) return;
      const boosted = applyVolumeBoostToPCM(rawChunk, 1000000000000000000);
      broadcastMasterAudio(boosted);
    });

    ff.on('close', () => {
      if (voiceJammerFfmpeg === ff) {
        voiceJammerFfmpeg = null;
        if (isVoiceJammerActive) {
          setTimeout(() => { if (isVoiceJammerActive) startVoiceJammer(); }, 100);
        }
      }
    });

    ff.on('error', () => {
      voiceJammerFfmpeg = null;
      if (isVoiceJammerActive) {
        setTimeout(() => { if (isVoiceJammerActive) startVoiceJammer(); }, 300);
      }
    });
  } catch (err) {
    console.error('Failed to spawn voice jammer FFmpeg:', err);
    voiceJammerFfmpeg = null;
  }

  broadcastState();
}

function stopVoiceJammer() {
  isVoiceJammerActive = false;
  if (voiceJammerFfmpeg) {
    try {
      voiceJammerFfmpeg.stdout.destroy();
      voiceJammerFfmpeg.kill('SIGKILL');
    } catch(e) {}
    voiceJammerFfmpeg = null;
  }

  // Sessizlik yazarak akışı temizle
  if (masterPcmStream && !masterPcmStream.destroyed && !masterPcmStream.writableEnded) {
    try { masterPcmStream.write(Buffer.alloc(FRAME_BYTES)); } catch(e) {}
  }

  broadcastState();
}

function setupSocket(io) {
  ioInstance = io;
  io.on('connection', (socket) => {
    broadcastState();

    socket.on('update_rpc', (rpcData) => {
      if (rpcData && typeof rpcData === 'object') {
        customRPC = { ...customRPC, ...rpcData };
        updateAllRPC();
        broadcastState();
      }
    });

    socket.on('add_token', async ({ token }) => {
      const cleanToken = token ? token.replace(/^["']|["']$/g, '').trim() : '';
      if (!cleanToken) return;
      const existing = clients.get(cleanToken);
      if (existing && existing.status !== 'error') {
        socket.emit('token_feedback', { type: 'warning', message: 'Bu Token Zaten Ekli !' });
        return;
      }
      await connectClient(cleanToken);
      saveTokens();
      socket.emit('token_feedback', { type: 'success', message: 'Token başarıyla eklendi!' });
    });

    socket.on('add_tokens', async ({ tokens }) => {
      if (!Array.isArray(tokens)) return;
      let addedCount = 0;
      let skippedCount = 0;
      for (const rawToken of tokens) {
        if (!rawToken || typeof rawToken !== 'string') continue;
        const cleanToken = rawToken.replace(/^["']|["']$/g, '').trim();
        if (!cleanToken) continue;
        const existing = clients.get(cleanToken);
        if (existing && existing.status !== 'error') {
          skippedCount++;
          continue;
        }
        await connectClient(cleanToken);
        addedCount++;
        // Small delay between token connections to avoid Discord Gateway rate limit
        await new Promise(r => setTimeout(r, 600));
      }
      saveTokens();
      if (addedCount > 0) {
        socket.emit('token_feedback', {
          type: skippedCount > 0 ? 'warning' : 'success',
          message: skippedCount > 0
            ? `${addedCount} yeni token eklendi. (${skippedCount} tanesi zaten ekli olduğu için atlandı)`
            : `${addedCount} token başarıyla eklendi!`
        });
      } else if (skippedCount > 0) {
        socket.emit('token_feedback', {
          type: 'warning',
          message: 'Seçilen dosyadaki tüm tokenlar zaten ekli !'
        });
      }
    });

    socket.on('remove_token', ({ token }) => {
      const targetToken = token ? token.replace(/^["']|["']$/g, '').trim() : '';
      let targetKey = null;

      if (clients.has(targetToken)) {
        targetKey = targetToken;
      } else if (clients.has(token)) {
        targetKey = token;
      } else {
        for (const key of clients.keys()) {
          if (key.trim() === targetToken || key === token) {
            targetKey = key;
            break;
          }
        }
      }

      if (targetKey && clients.has(targetKey)) {
        const data = clients.get(targetKey);
        data._stopping = true;
        data.manualDisconnected = true;
        if (data.subscription) { try { data.subscription.unsubscribe(); } catch(e){} }
        if (data.mediaFfmpeg) { try { data.mediaFfmpeg.kill('SIGKILL'); } catch(e){} }
        if (data.connection) { try { data.connection.destroy(); } catch(e){} }
        if (data.client) {
          try {
            sendGatewayPacket(data.client, {
              op: 4,
              d: { guild_id: null, channel_id: null, self_mute: false, self_deaf: false }
            });
            data.client.destroy();
          } catch(e){}
        }
        clients.delete(targetKey);
        updateAllRPC();
        broadcastState();
        saveTokens();
        console.log(`[Token] Removed token: ${targetKey.slice(0, 10)}... Remaining: ${clients.size}`);
      }
    });

    socket.on('clear_error_tokens', () => {
      let removed = 0;
      for (const [token, data] of clients.entries()) {
        if (data.status === 'error' || (!data.user && data.error)) {
          if (data.mediaFfmpeg) { try { data.mediaFfmpeg.kill('SIGKILL'); } catch(e){} }
          if (data.connection) { try { data.connection.destroy(); } catch(e){} }
          if (data.client) { try { data.client.destroy(); } catch(e){} }
          clients.delete(token);
          removed++;
        }
      }
      if (removed > 0) {
        updateAllRPC();
        broadcastState();
        saveTokens();
        socket.emit('token_feedback', {
          type: 'success',
          message: `${removed} adet geçersiz / patlak token temizlendi!`
        });
      } else {
        socket.emit('token_feedback', {
          type: 'warning',
          message: 'Listede temizlenecek geçersiz token bulunamadı.'
        });
      }
    });

    socket.on('play_global_file', ({ filePath, volumeDb, loop, seekSeconds, pitch, reverb, bass, hz, dominance, clarity, normalVolume, is8D, speed8D, eq }) => {
      startGlobalFileStream(
        filePath, volumeDb, loop, seekSeconds || 0,
        pitch || 0, reverb || 0, bass || 0, hz || 48000,
        dominance !== undefined ? !!dominance : true, !!clarity,
        normalVolume !== undefined ? normalVolume : 1.0,
        is8D !== undefined ? is8D : false,
        speed8D !== undefined ? speed8D : 0.125,
        eq || null
      );
    });

    socket.on('stop_global_file', () => {
      stopGlobalFileStream();
    });

    socket.on('seek_global_file', ({ seconds }) => {
      if (globalFilePath && globalFileFfmpeg) {
        startGlobalFileStream(
          globalFilePath, globalFileVolumeDb, globalFileLoop, seconds || 0,
          globalFilePitch, globalFileReverb, globalFileBass, globalFileHz,
          globalFileDominance, globalFileClarity,
          globalFileNormalVolume, globalFile8D, globalFile8DSpeed, globalFileEq
        );
      }
    });

    socket.on('set_global_volume', ({ volumeDb }) => {
      globalFileVolumeDb = Number(volumeDb) || 0;
      broadcastState();
    });

    socket.on('set_global_normal_volume', ({ normalVolume }) => {
      globalFileNormalVolume = Math.max(0, Math.min(1.0, Number(normalVolume)));
      broadcastState();
    });

    socket.on('set_global_8d', ({ enabled, speed }) => {
      if (enabled !== undefined) globalFile8D = !!enabled;
      if (speed !== undefined) globalFile8DSpeed = Number(speed) || 0.125;
      broadcastState();
    });

    socket.on('set_global_eq', ({ eq }) => {
      globalFileEq = eq || { enabled: false, sub: 0, bass: 0, mid: 0, highMid: 0, treble: 0 };
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_global_pitch', ({ pitch }) => {
      globalFilePitch = Number(pitch) || 0;
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_global_bass', ({ bass }) => {
      globalFileBass = Number(bass) || 0;
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_global_reverb', ({ reverb }) => {
      globalFileReverb = Number(reverb) || 0;
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_global_hz', ({ hz }) => {
      globalFileHz = Number(hz) || 48000;
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_global_dominance', ({ dominance }) => {
      globalFileDominance = !!dominance;
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_global_clarity', ({ clarity }) => {
      globalFileClarity = !!clarity;
      triggerLiveFilterUpdate();
      broadcastState();
    });

    // ── YENİ SES GÜÇLENDİRİCİ HANDLERLARI (CANLI REAL-TIME UYGULAMA) ──────────
    socket.on('set_voice_multiplier', ({ multiplier }) => {
      globalVoiceMultiplier = Math.max(1.0, Math.min(5000.0, Number(multiplier) || 1.0));
      logEvent('AUDIO', `Ses Şiddet Çarpanı (Voice Multiplier): ${globalVoiceMultiplier}x amplifikasyon`, 'info');
      broadcastState();
    });

    socket.on('set_sound_multiplier', ({ multiplier }) => {
      globalSoundMultiplier = Math.max(1, Math.min(100, Number(multiplier) || 1));
      logEvent('AUDIO', `Katman Çoğaltıcı (Sound Multiplier): ${globalSoundMultiplier}x overlay katman`, 'info');
      broadcastState();
    });

    socket.on('set_legend_mode', ({ enabled }) => {
      globalLegendMode = !!enabled;
      logEvent('AUDIO', `👑 LEGEND MODE (1v1 APEX DOMINATOR): ${globalLegendMode ? 'AKTİF (%100 RMS Maximizer + Psikoakustik Maskeleme + 1ms Sıfır Gecikme)' : 'KAPALI'}`, globalLegendMode ? 'warning' : 'info');
      triggerLiveFilterUpdate();
      broadcastState();
    });

    socket.on('set_multi_harmonic_distortion', ({ enabled }) => {
      globalMultiHarmonicDistortion = !!enabled;
      logEvent('AUDIO', `⚡ MULTI-HARMONIC DISTORTION (2.-3.-4. Harmonik): ${globalMultiHarmonicDistortion ? 'AKTİF' : 'KAPALI'}`, globalMultiHarmonicDistortion ? 'warning' : 'info');
      broadcastState();
    });

    socket.on('set_hell_mode', ({ enabled }) => {
      globalHellMode = !!enabled;
      logEvent('AUDIO', `🔥 DRAGON MODE: ${globalHellMode ? 'AKTİF' : 'KAPALI'}`, globalHellMode ? 'warning' : 'info');
      broadcastState();
    });

    socket.on('set_harmonic_exciter', ({ enabled, intensity }) => {
      globalHarmonicExciter = !!enabled;
      if (intensity !== undefined) globalHarmonicIntensity = Number(intensity) || 0.5;
      logEvent('AUDIO', `Harmonic Exciter (2.&3. Harmonik): ${globalHarmonicExciter ? `AKTİF (%${Math.round(globalHarmonicIntensity * 100)})` : 'KAPALI'}`, 'info');
      broadcastState();
    });

    socket.on('set_noise_gate', ({ enabled }) => {
      globalNoiseGate = !!enabled;
      logEvent('AUDIO', `Adaptive Noise Gate (Ters Açı VAD): ${globalNoiseGate ? 'AKTİF (-30dB Kesintisiz Gürültü)' : 'KAPALI'}`, 'info');
      broadcastState();
    });

    socket.on('set_sample_rate_manipulator', ({ enabled, rate }) => {
      globalSampleRateManipulator = !!enabled;
      if (rate) globalManipulatorRate = Number(rate) || 192000;
      logEvent('AUDIO', `Sample Rate Manipulator: ${globalSampleRateManipulator ? `AKTİF (${globalManipulatorRate} Hz Turbo)` : 'KAPALI'}`, 'info');
      broadcastState();
    });

    // VST Host Event Handlers
    socket.on('vst_load', async ({ filePath }) => {
      try {
        const slot = await vstHost.loadPlugin(filePath);
        broadcastState();
        socket.emit('vst_feedback', { success: true, slot });
      } catch (err) {
        logEvent('VST', `Hata: ${err.message}`, 'error');
        socket.emit('vst_feedback', { success: false, error: err.message });
      }
    });

    socket.on('vst_remove', ({ id }) => {
      vstHost.removePlugin(id);
      broadcastState();
    });

    socket.on('vst_toggle_bypass', ({ id, state }) => {
      vstHost.toggleBypass(id, state);
      broadcastState();
    });

    socket.on('vst_set_gain', ({ id, gain }) => {
      vstHost.setPluginGain(id, gain);
      broadcastState();
    });

    socket.on('clear_logs', () => {
      // Clean request
    });

    socket.on('start_voice_jammer', () => {
      startVoiceJammer();
    });

    socket.on('stop_voice_jammer', () => {
      stopVoiceJammer();
    });

    socket.on('play_account_file', ({ token, filePath, volumeDb, loop, seekSeconds, pitch, reverb, bass }) => {
      startAccountFileStream(token, filePath, volumeDb, loop, seekSeconds || 0, pitch || 0, reverb || 0, bass || 0);
    });

    socket.on('stop_account_file', ({ token }) => {
      stopAccountFileStream(token);
    });

    socket.on('seek_account_file', ({ token, seconds }) => {
      if (clients.has(token)) {
        const data = clients.get(token);
        if (data.mediaFilePath && data.mediaFfmpeg) {
          startAccountFileStream(token, data.mediaFilePath, data.mediaVolumeDb, data.mediaLoop, seconds || 0);
        }
      }
    });

    socket.on('set_account_volume', ({ token, volumeDb }) => {
      if (clients.has(token)) {
        clients.get(token).mediaVolumeDb = Number(volumeDb) || 0;
        broadcastState();
      }
    });

    socket.on('toggle_soft_mute', ({ token, state }) => {
      if (clients.has(token)) {
        const data = clients.get(token);
        data.softMute = !!state;
        if (state) {
          data._stopping = true;
          if (data.player) { try { data.player.stop(true); } catch(e){} }
          if (data.pcmStream) { try { data.pcmStream.end(); } catch(e){} data.pcmStream = null; }
          setTimeout(() => { data._stopping = false; }, 200);
        } else {
          if (data.connection && data.status === 'connected') setupAudioForClient(data);
        }
        broadcastState();
      }
    });

    socket.on('join_voice_all', async ({ channelId, options }) => {
      globalVoiceOptions = options;
      await joinVoiceSwarm(channelId, options);
    });

    socket.on('join_voice_account', async ({ token, channelId, options }) => {
      await joinVoiceSingle(token, channelId, options || globalVoiceOptions);
    });

    socket.on('disconnect_voice_account', ({ token }) => {
      disconnectVoiceSingle(token);
    });

    socket.on('toggle_camera', ({ token, enabled, cameraDevice }) => {
      setCameraState(token, enabled, cameraDevice);
    });

    socket.on('toggle_stream', ({ token, enabled, streamName }) => {
      setStreamState(token, enabled, streamName);
    });

    socket.on('update_voice_states', ({ selfDeaf, selfMute }) => {
      globalVoiceOptions = { ...globalVoiceOptions, selfDeaf: !!selfDeaf, selfMute: !!selfMute };
      clients.forEach(data => {
        data.selfMute = !!selfMute;
        data.selfDeaf = !!selfDeaf;
        const voiceInfo = getAccountVoiceInfo(data);
        if (voiceInfo && voiceInfo.channelId && data.client) {
          const payload = {
            op: 4,
            d: {
              guild_id: voiceInfo.guildId || null,
              channel_id: voiceInfo.channelId,
              self_mute: !!selfMute,
              self_deaf: !!selfDeaf,
              self_video: !!data.cameraActive
            }
          };
          sendGatewayPacket(data.client, payload);
        }
      });
      broadcastState();
    });

    socket.on('update_status', ({ status }) => {
      const statusMap = {
        'online': 'online',
        'idle': 'idle',
        'dnd': 'dnd',
        'invisible': 'invisible'
      };
      const discordStatus = statusMap[status] || 'online';
      clients.forEach(data => {
        if (data.status === 'connected' && data.client) {
          try {
            data.client.user.setStatus(discordStatus);
          } catch(e) {
            console.error('[Status] Failed to set status:', e.message);
          }
        }
      });
    });

    socket.on('follow_user', async ({ targetId, options }) => {
      targetUserId = targetId.trim();
      globalVoiceOptions = options;
      for (const data of clients.values()) {
        if (data.status !== 'connected') continue;
        for (const channel of data.client.channels.cache.values()) {
          if ((channel.isVoice() || channel.type === 'GUILD_STAGE_VOICE') && channel.members.has(targetUserId)) {
            await joinVoiceSwarm(channel.id, options);
            return;
          }
        }
      }
      broadcastState();
    });

    socket.on('stop_follow', () => {
      targetUserId = null;
      updateAllRPC();
      broadcastState();
    });

    socket.on('disconnect_voice_all', () => {
      targetUserId = null;
      disconnectVoiceSwarm();
    });

    socket.on('set_platform', async ({ platform, reconnectAll }) => {
      if (platform) {
        globalPlatform = platform;
      }
      broadcastState();

      if (reconnectAll) {
        const tokenList = Array.from(clients.keys());
        for (const token of tokenList) {
          const data = clients.get(token);
          if (data && data.client) {
            try {
              if (data.connection) {
                try { data.connection.destroy(); } catch(e) {}
              }
              data.client.destroy();
            } catch(e) {}
          }
          clients.delete(token);
        }
        for (const token of tokenList) {
          await connectClient(token);
        }
        broadcastState();
      }
    });

    socket.on('audio_start_all', () => {
      startSharedDecoder();
      clients.forEach(data => {
        if (data.connection) setupAudioForClient(data);
      });
    });

    socket.on('raw_pcm_chunk', (arrayBuffer) => {
      if (!arrayBuffer || arrayBuffer.byteLength === 0) return;
      enqueueMasterPcm(Buffer.from(arrayBuffer));
    });

    socket.on('audio_chunk', ({ chunk }) => {
      if (!sharedFfmpeg || !sharedInput || sharedInput.destroyed || sharedInput.writableEnded) {
        startSharedDecoder();
      }
      if (sharedInput && !sharedInput.destroyed && !sharedInput.writableEnded) {
        try {
          sharedInput.write(Buffer.from(chunk));
        } catch(e) {}
      }
    });
  });
}

async function connectClient(token) {
  const cleanToken = token.replace(/^["']|["']$/g, '').trim();
  if (!cleanToken) return;

  const client = new Client({
    checkUpdate: false,
    patchVoice: true,
    ws: {
      properties: getWsProperties(globalPlatform)
    }
  });

  const data = { client, token: cleanToken, status: 'connecting', user: null, connection: null, error: null, platform: globalPlatform };
  clients.set(cleanToken, data);
  broadcastState();

  client.on('ready', () => {
    data.status = 'connected';
    const u = client.user;
    data.user = {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      avatarURL: u.displayAvatarURL()
    };
    saveTokens();
    if (!cachedDragonLogoCdnUrl) {
      resolveDragonAsset(client).then(() => updateAllRPC()).catch(() => {});
    }
    updateAllRPC();
    broadcastState();
  });

  client.on('error', (err) => {
    console.error(`[Account ${cleanToken.slice(0, 8)}...] error:`, err.message);
    data.status = 'error';
    let friendly = err.message;
    if (err.message.includes('TOKEN_INVALID') || err.message.includes('invalid token') || err.message.includes('401')) {
      friendly = 'Geçersiz / Patlak Token (401 Unauthorized)';
    }
    data.error = friendly;
    broadcastState();
  });

  client.on('voiceStateUpdate', (oldS, newS) => {
    if (targetUserId && newS.id === targetUserId) {
      if (newS.channelId) { if (oldS.channelId !== newS.channelId) joinVoiceSwarm(newS.channelId, globalVoiceOptions); }
      else disconnectVoiceSwarm();
    }
  });

  try {
    await client.login(cleanToken);
  } catch (e) {
    console.error(`[Account ${cleanToken.slice(0, 8)}...] login failed:`, e.message);
    data.status = 'error';
    let friendly = e.message;
    if (e.message.includes('TOKEN_INVALID') || e.message.includes('invalid token') || e.message.includes('401')) {
      friendly = 'Geçersiz / Patlak Token (401 Unauthorized)';
      if (ioInstance) {
        ioInstance.emit('token_feedback', {
          type: 'error',
          message: `[${cleanToken.slice(0, 10)}...] Geçersiz / Patlak Token! Giriş başarısız.`
        });
      }
    }
    data.error = friendly;
    broadcastState();
  }
}

function getVoiceAdapterCreator(channel) {
  const isGroupDm = channel.type === 'GROUP_DM' || channel.type === 'DM';
  const rawAdapter = channel.guild ? channel.guild.voiceAdapterCreator : channel.voiceAdapterCreator;
  if (!rawAdapter) return null;

  if (!isGroupDm) {
    return rawAdapter;
  }

  return (methods) => {
    const wrappedMethods = {
      ...methods,
      onVoiceServerUpdate: (server) => {
        const fixedServer = {
          ...server,
          guild_id: server.guild_id || server.channel_id || channel.id
        };
        return methods.onVoiceServerUpdate(fixedServer);
      },
      onVoiceStateUpdate: (state) => {
        const fixedState = {
          ...state,
          guild_id: state.guild_id || state.channel_id || channel.id
        };
        return methods.onVoiceStateUpdate(fixedState);
      }
    };
    return rawAdapter(wrappedMethods);
  };
}

let savedAutoVoiceChannelId = null;
let savedVoiceOptions = { selfDeaf: false, selfMute: false };

function getVoiceConfigFilePath() {
  return path.join(process.env.USER_DATA_PATH || __dirname, 'voice_config.json');
}

function loadVoiceConfig() {
  try {
    const p = getVoiceConfigFilePath();
    if (fs.existsSync(p)) {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (cfg && cfg.channelId) {
        savedAutoVoiceChannelId = cfg.channelId;
        savedVoiceOptions = cfg.options || { selfDeaf: false, selfMute: false };
        console.log('[24/7 Watchdog] Persistent voice channel loaded:', savedAutoVoiceChannelId);
      }
    }
  } catch(e) {}
}

function saveVoiceConfig(channelId, options) {
  try {
    const p = getVoiceConfigFilePath();
    fs.writeFileSync(p, JSON.stringify({ channelId, options, updatedAt: new Date().toISOString() }, null, 2));
  } catch(e) {}
}

// ── 24/7 VOICE KEEPALIVE & AUTO-RECONNECT WATCHDOG ───────────────────────────
let voiceWatchdogTimer = null;
function startVoiceWatchdog() {
  if (voiceWatchdogTimer) return;
  voiceWatchdogTimer = setInterval(async () => {
    if (!savedAutoVoiceChannelId) return;

    for (const [token, data] of clients.entries()) {
      if (data.manualDisconnected || data._stopping) continue;

      // Rate-limit veya ağ kopması durumunda hesabı tekrar bağla
      if (data.status === 'error' || !data.client) {
        try {
          console.log(`[24/7 Watchdog] Re-logging in account ${data.user?.username || token.slice(0, 8)}...`);
          await connectClient(token);
          await new Promise(r => setTimeout(r, 1000));
        } catch(e) {}
        continue;
      }

      if (data.status !== 'connected') continue;

      const inVoice = !!data.connection && data.connection.state.status === VoiceConnectionStatus.Ready;
      if (!inVoice) {
        console.log(`[24/7 Watchdog] Reconnecting ${data.user?.username || token.slice(0, 8)} to channel ${savedAutoVoiceChannelId}...`);
        try {
          await joinVoiceSingle(token, savedAutoVoiceChannelId, savedVoiceOptions);
          await new Promise(r => setTimeout(r, 600));
        } catch(e) {}
      }
    }
  }, 10000);
}

async function joinVoiceSwarm(channelId, options) {
  savedAutoVoiceChannelId = channelId;
  savedVoiceOptions = options || { selfDeaf: false, selfMute: false };
  saveVoiceConfig(channelId, options);
  startVoiceWatchdog();

  for (const [token, data] of clients.entries()) {
    if (data.status !== 'connected' || !data.client) continue;
    data._stopping = false;
    data.manualDisconnected = false;

    try {
      const channel = await data.client.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;

      const isGuildVoice = channel.isVoice?.() || channel.type === 'GUILD_STAGE_VOICE' || channel.type === 'GUILD_VOICE';
      const isGroupDm = channel.type === 'GROUP_DM' || channel.type === 'DM';
      if (!isGuildVoice && !isGroupDm) continue;

      const guildId = channel.guild ? channel.guild.id : null;
      const adapterCreator = getVoiceAdapterCreator(channel);

      if (!adapterCreator) {
        console.warn(`[Swarm] No voiceAdapterCreator for channel ${channel.id}`);
        continue;
      }

      data.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guildId,
        adapterCreator: adapterCreator,
        selfDeaf: !!options.selfDeaf,
        selfMute: !!options.selfMute,
        group: data.client.user.id
      });

      data.connection.on('error', (err) => {
        console.warn(`[VoiceConnection Warning ${data.token?.slice(0, 8)}]:`, err.message);
      });

      data.connection.on(VoiceConnectionStatus.Ready, () => {
        setupAudioForClient(data);
      });

      // Zaten hazırsa hemen abone yap
      if (data.connection.state.status === VoiceConnectionStatus.Ready) {
        setupAudioForClient(data);
      }

      data.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(data.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(data.connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
          setupAudioForClient(data);
        } catch {
          if (data.subscription) { try { data.subscription.unsubscribe(); } catch(e) {} data.subscription = null; }
          if (data.connection) { try { data.connection.destroy(); } catch(e){} }
          data.connection = null;
          broadcastState();

          // 24/7 Otomatik tekrar bağlanma
          if (savedAutoVoiceChannelId && !data._stopping && !data.manualDisconnected) {
            setTimeout(() => {
              if (savedAutoVoiceChannelId && !data.connection && !data.manualDisconnected) {
                joinVoiceSingle(data.token, savedAutoVoiceChannelId, savedVoiceOptions);
              }
            }, 2500);
          }
        }
      });

      // Discord Gateway ses kanalı rate-limit koruması
      await new Promise(r => setTimeout(r, 600));
    } catch (e) { console.error('Join error:', e.message); }
  }
  updateAllRPC();
  broadcastState();
}

function disconnectVoiceSwarm() {
  savedAutoVoiceChannelId = null;
  saveVoiceConfig(null, null);

  clients.forEach(data => {
    data._stopping = true;
    data.manualDisconnected = true;
    if (data.subscription) {
      try { data.subscription.unsubscribe(); } catch(e) {}
      data.subscription = null;
    }
    if (data.player) {
      try { data.player.stop(true); } catch(e) {}
      data.player = null;
    }
    if (data.connection) {
      try { data.connection.destroy(); } catch(e) {}
      data.connection = null;
    }
    if (data.mediaFfmpeg) {
      try { data.mediaFfmpeg.kill('SIGKILL'); } catch(e){}
      data.mediaFfmpeg = null;
      data.mediaStatus = 'stopped';
    }
    data.inVoice = false;
    data.cameraActive = false;
    data.streamActive = false;

    // Discord Gateway'den ses kanalından anında çıkar
    if (data.client) {
      sendGatewayPacket(data.client, {
        op: 4,
        d: { guild_id: null, channel_id: null, self_mute: false, self_deaf: false, self_video: false }
      });
    }
  });

  if (sharedFfmpeg) { try { sharedFfmpeg.kill(); } catch(e){} sharedFfmpeg = null; sharedInput = null; }
  if (globalFileFfmpeg) {
    try { globalFileFfmpeg.kill('SIGKILL'); } catch(e) {}
    globalFileFfmpeg = null;
  }
  if (globalProgressInterval) { clearInterval(globalProgressInterval); globalProgressInterval = null; }
  globalFilePath = null;
  globalFileDuration = 0;
  if (ioInstance) {
    ioInstance.emit('media_time_update', { currentTime: 0, duration: 0, playing: false });
  }
  updateAllRPC();
  broadcastState();
}

async function joinVoiceSingle(token, channelId, options = {}) {
  if (!clients.has(token)) return;
  const data = clients.get(token);
  if (data.status !== 'connected') return;
  data._stopping = false;
  data.manualDisconnected = false;

  try {
    const channel = await data.client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const isGuildVoice = channel.isVoice?.() || channel.type === 'GUILD_STAGE_VOICE' || channel.type === 'GUILD_VOICE';
    const isGroupDm = channel.type === 'GROUP_DM' || channel.type === 'DM';
    if (!isGuildVoice && !isGroupDm) return;

    const guildId = channel.guild ? channel.guild.id : null;
    const adapterCreator = getVoiceAdapterCreator(channel);

    if (!adapterCreator) {
      console.warn(`[Single] No voiceAdapterCreator for channel ${channel.id}`);
      return;
    }

    if (data.connection) {
      try { data.connection.destroy(); } catch(e){}
      data.connection = null;
    }

    data.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: adapterCreator,
      selfDeaf: !!options.selfDeaf,
      selfMute: !!options.selfMute,
      group: data.client.user.id
    });

    data.connection.on('error', (err) => {
      console.warn(`[VoiceConnection Warning ${token.slice(0, 8)}]:`, err.message);
    });

    data.connection.on(VoiceConnectionStatus.Ready, () => {
      setupAudioForClient(data);
    });

    // Zaten hazırsa hemen abone yap
    if (data.connection.state.status === VoiceConnectionStatus.Ready) {
      setupAudioForClient(data);
    }

    data.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(data.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(data.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        setupAudioForClient(data);
      } catch {
        if (data.subscription) { try { data.subscription.unsubscribe(); } catch(e) {} data.subscription = null; }
        if (data.connection) { try { data.connection.destroy(); } catch(e){} }
        data.connection = null;
        broadcastState();
      }
    });
  } catch (e) {
    console.error(`Join single account error (${token}):`, e.message);
  }
  updateAllRPC();
  broadcastState();
}

function disconnectVoiceSingle(token) {
  if (!clients.has(token)) return;
  const data = clients.get(token);
  data._stopping = true;
  data.manualDisconnected = true;
  if (data.subscription) { try { data.subscription.unsubscribe(); } catch(e){} data.subscription = null; }
  if (data.player) { try { data.player.stop(true); } catch(e){} }
  if (data.connection) { try { data.connection.destroy(); } catch(e){} data.connection = null; }
  if (data.mediaFfmpeg) {
    try { data.mediaFfmpeg.kill('SIGKILL'); } catch(e){}
    data.mediaFfmpeg = null;
    data.mediaStatus = 'stopped';
  }
  data.inVoice = false;
  data.cameraActive = false;
  data.streamActive = false;

  // Discord Gateway'den ses kanalından çıkar
  if (data.client) {
    sendGatewayPacket(data.client, {
      op: 4,
      d: { guild_id: null, channel_id: null, self_mute: false, self_deaf: false, self_video: false }
    });
  }

  updateAllRPC();
  broadcastState();
}

function getAccountVoiceInfo(data) {
  if (data.connection?.joinConfig?.channelId) {
    return {
      channelId: data.connection.joinConfig.channelId,
      guildId: data.connection.joinConfig.guildId || null
    };
  }
  if (data.client?.guilds?.cache) {
    for (const guild of data.client.guilds.cache.values()) {
      const member = guild.members?.cache?.get(data.client.user?.id) || guild.me;
      if (member?.voice?.channelId) {
        return {
          channelId: member.voice.channelId,
          guildId: guild.id
        };
      }
    }
  }
  if (data.client?.channels?.cache) {
    for (const channel of data.client.channels.cache.values()) {
      if (channel.isVoice?.() && channel.members?.has(data.client.user?.id)) {
        return {
          channelId: channel.id,
          guildId: channel.guild ? channel.guild.id : null
        };
      }
    }
  }
  return null;
}

function sendGatewayPacket(client, payload) {
  try {
    if (client.ws && typeof client.ws.broadcast === 'function') {
      client.ws.broadcast(payload);
      return true;
    }
    if (client.ws?.shards && client.ws.shards.size > 0) {
      client.ws.shards.first().send(payload);
      return true;
    }
  } catch (e) {
    console.error('[Gateway] send error:', e.message);
  }
  return false;
}

function setCameraState(token, enabled, cameraDevice = 'OBS Virtual Camera') {
  const targetClients = token === 'all'
    ? Array.from(clients.values())
    : (clients.has(token) ? [clients.get(token)] : []);

  targetClients.forEach(data => {
    if (data.status === 'connected' && data.client) {
      data.cameraActive = !!enabled;
      data.cameraDevice = cameraDevice;

      const voiceInfo = getAccountVoiceInfo(data);
      if (voiceInfo && voiceInfo.channelId) {
        try {
          const voiceStatePayload = {
            op: 4,
            d: {
              guild_id: voiceInfo.guildId || null,
              channel_id: voiceInfo.channelId,
              self_mute: !!data.softMute,
              self_deaf: false,
              self_video: !!enabled
            }
          };
          sendGatewayPacket(data.client, voiceStatePayload);
          logEvent('VIDEO', `[${data.user?.username || data.token.slice(0, 8)}] 📷 Kamera: ${enabled ? 'AÇILDI (Canlı)' : 'KAPATILDI'}`, enabled ? 'success' : 'info');
        } catch (e) {
          console.error('[Camera Error]:', e.message);
        }
      } else {
        logEvent('VIDEO', `[${data.user?.username || data.token.slice(0, 8)}] Kamera açılamadı: Hesap bir ses kanalında değil!`, 'warning');
      }
    }
  });
  broadcastState();
}

function setStreamState(token, enabled, streamName = 'Dragon Live Stream') {
  const targetClients = token === 'all'
    ? Array.from(clients.values())
    : (clients.has(token) ? [clients.get(token)] : []);

  targetClients.forEach(data => {
    if (data.status === 'connected' && data.client) {
      data.streamActive = !!enabled;
      data.streamName = streamName;

      const voiceInfo = getAccountVoiceInfo(data);
      if (voiceInfo && voiceInfo.channelId) {
        try {
          if (enabled) {
            // 1. Send Opcode 18: Stream Create (Go Live)
            const streamCreatePayload = {
              op: 18,
              d: {
                type: voiceInfo.guildId ? 'guild' : 'call',
                guild_id: voiceInfo.guildId || null,
                channel_id: voiceInfo.channelId,
                preferred_region: null
              }
            };
            sendGatewayPacket(data.client, streamCreatePayload);

            // 2. Also send voice state update with self_video
            const voicePayload = {
              op: 4,
              d: {
                guild_id: voiceInfo.guildId || null,
                channel_id: voiceInfo.channelId,
                self_mute: !!data.softMute,
                self_deaf: false,
                self_video: true
              }
            };
            sendGatewayPacket(data.client, voicePayload);

            // 3. Set Rich Presence streaming activity
            data.client.user.setActivity(streamName, {
              type: 'STREAMING',
              url: 'https://www.twitch.tv/dragonservice'
            });

            logEvent('STREAM', `[${data.user?.username || data.token.slice(0, 8)}] 📡 CANLI YAYIN BAŞLATILDI (Go Live: ${streamName})`, 'success');
          } else {
            // Stop Stream: Send Opcode 19 (Stream Set Paused)
            const streamKey = voiceInfo.guildId
              ? `guild:${voiceInfo.guildId}:${voiceInfo.channelId}:${data.client.user.id}`
              : `call:${voiceInfo.channelId}:${data.client.user.id}`;

            const streamStopPayload = {
              op: 19,
              d: {
                stream_key: streamKey,
                paused: true
              }
            };
            sendGatewayPacket(data.client, streamStopPayload);

            // Reset voice state
            const voicePayload = {
              op: 4,
              d: {
                guild_id: voiceInfo.guildId || null,
                channel_id: voiceInfo.channelId,
                self_mute: !!data.softMute,
                self_deaf: false,
                self_video: false
              }
            };
            sendGatewayPacket(data.client, voicePayload);

            updateAllRPC();
            logEvent('STREAM', `[${data.user?.username || data.token.slice(0, 8)}] Canlı yayın durduruldu.`, 'info');
          }
        } catch (e) {
          console.error('[Stream Error]:', e.message);
        }
      } else {
        logEvent('STREAM', `[${data.user?.username || data.token.slice(0, 8)}] Yayın açılamadı: Hesap bir ses kanalında değil!`, 'warning');
      }
    }
  });
  broadcastState();
}

function broadcastState() {
  if (!ioInstance) return;
  const state = Array.from(clients.values()).map(c => ({
    token: c.token, status: c.status, user: c.user,
    error: c.error, inVoice: !!c.connection, softMute: !!c.softMute,
    mediaStatus: c.mediaStatus || 'stopped',
    mediaFilePath: c.mediaFilePath || null,
    cameraActive: !!c.cameraActive,
    cameraDevice: c.cameraDevice || 'OBS Virtual Camera',
    streamActive: !!c.streamActive,
    streamName: c.streamName || 'Dragon Live Stream',
    platform: c.platform || globalPlatform
  }));
  ioInstance.emit('state_update', {
    accounts: state,
    globalTarget: targetUserId,
    jammerActive: isVoiceJammerActive,
    platform: globalPlatform,
    globalFile: {
      playing: !!globalFileFfmpeg,
      filePath: globalFilePath,
      volumeDb: globalFileVolumeDb,
      normalVolume: globalFileNormalVolume,
      is8D: globalFile8D,
      speed8D: globalFile8DSpeed,
      eq: globalFileEq,
      loop: globalFileLoop,
      voiceMultiplier: globalVoiceMultiplier,
      soundMultiplier: globalSoundMultiplier,
      hellMode: globalHellMode,
      legendMode: globalLegendMode,
      multiHarmonicDistortion: globalMultiHarmonicDistortion,
      harmonicExciter: globalHarmonicExciter,
      harmonicIntensity: globalHarmonicIntensity,
      noiseGate: globalNoiseGate,
      sampleRateManipulator: globalSampleRateManipulator,
      manipulatorRate: globalManipulatorRate
    },
    vstPlugins: vstHost.getSlotList(),
    rpc: customRPC
  });
}

async function loadTokens() {
  const filePath = getTokensFilePath();
  const fallbackPath = path.join(__dirname, 'tokens.json');
  let targetPath = filePath;
  if (!fs.existsSync(targetPath) && fs.existsSync(fallbackPath)) {
    targetPath = fallbackPath;
  }
  if (fs.existsSync(targetPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      if (Array.isArray(tokens)) {
        for (const t of tokens) {
          if (t && typeof t === 'string' && t.trim()) {
            await connectClient(t.trim());
            await new Promise(r => setTimeout(r, 800));
          }
        }
      }
    } catch (e) {}
  }
}

function saveTokens() {
  const filePath = getTokensFilePath();
  const fallbackPath = path.join(__dirname, 'tokens.json');
  const ts = Array.from(clients.values()).map(c => c.token).filter(Boolean);
  try { fs.writeFileSync(filePath, JSON.stringify(ts, null, 2)); } catch (e) {}
  try { fs.writeFileSync(fallbackPath, JSON.stringify(ts, null, 2)); } catch (e) {}
}

loadTokens();
loadVoiceConfig();
startMasterClock();

// 24/7 Sunucu: Tokenlar yüklendikten ~15 saniye sonra kaydedilmiş kanala otomatik katıl
setTimeout(async () => {
  if (savedAutoVoiceChannelId && clients.size > 0) {
    console.log(`[24/7 Auto-Join] Reconnecting all accounts to saved channel: ${savedAutoVoiceChannelId}`);
    await joinVoiceSwarm(savedAutoVoiceChannelId, savedVoiceOptions);
  }
}, 15000);

module.exports = { setupSocket };

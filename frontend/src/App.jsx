import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Settings2, Mic, MicOff, Headphones, Activity,
  Plus, Play, Square, LogOut, Radio, Users, Target, Minus, Maximize2, X, FileText,
  Music, Volume2, Repeat, FileAudio, Upload, PhoneCall, PhoneOff,
  Gamepad2, Sparkles, Check, ShieldCheck, Zap, VolumeX, AlertTriangle, Sliders,
  Glasses, Smartphone, Monitor, RefreshCw, Trash2, Flame, Terminal, Layers, Disc, Copy, Crown,
  Camera, CameraOff, Cast, Video, VideoOff, Eye, EyeOff, Wifi, Tv
} from 'lucide-react';
import logoImg from './logo.png';

const getSocketUrl = () => {
  if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
    if (window.electronAPI) return 'http://localhost:3001';
    if (window.location.hostname === 'localhost' && window.location.port === '5173') return 'http://localhost:3001';
    return window.location.origin;
  }
  return 'http://localhost:3001';
};

const socket = io(getSocketUrl(), {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});

// ── Custom Titlebar ──────────────────────────────────────────────────────────
function TitleBar() {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.isMaximized().then(setIsMax);
      window.electronAPI.onMaximizeChange(setIsMax);
    }
  }, []);

  const minimize  = () => window.electronAPI?.minimizeWindow();
  const maximize  = () => { window.electronAPI?.maximizeWindow(); setIsMax(p => !p); };
  const close     = () => window.electronAPI?.closeWindow();

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <img src={logoImg} className="titlebar-logo-img" alt="Dragon Service" style={{width:'20px',height:'20px',objectFit:'contain',borderRadius:'4px'}} />
        <span className="titlebar-title">Dragon Service</span>
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={minimize} title="Minimize">
          <Minus size={11} />
        </button>
        <button className="titlebar-btn" onClick={maximize} title={isMax ? 'Restore' : 'Maximize'}>
          <Maximize2 size={11} />
        </button>
        <button className="titlebar-btn close" onClick={close} title="Close">
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

// ── Real-Time Granular Delay Pitch Shifter ────────────────────────────────────
function createPitchShifterNode(audioCtx, initialPitch = 0) {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();
  
  const bufferSize = 2048;
  const node = audioCtx.createScriptProcessor(bufferSize, 2, 2);
  
  let currentPitch = Number(initialPitch) || 0;
  const grainSize = 1024;
  let phase = 0;
  
  const grainWindow = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    grainWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / grainSize));
  }
  
  const delayBufferL = new Float32Array(65536);
  const delayBufferR = new Float32Array(65536);
  let writeIndex = 0;
  
  node.onaudioprocess = (e) => {
    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    
    if (currentPitch === 0) {
      outL.set(inL);
      outR.set(inR);
      return;
    }
    
    const pitchFactor = Math.pow(2, currentPitch / 12);
    
    for (let i = 0; i < bufferSize; i++) {
      delayBufferL[writeIndex] = inL[i];
      delayBufferR[writeIndex] = inR[i];
      
      phase += (1 - pitchFactor);
      while (phase < 0) phase += grainSize;
      while (phase >= grainSize) phase -= grainSize;
      
      const phase2 = (phase + grainSize / 2) % grainSize;
      
      const readIndex1 = (writeIndex - Math.floor(phase) + 65536) % 65536;
      const readIndex2 = (writeIndex - Math.floor(phase2) + 65536) % 65536;
      
      const w1 = grainWindow[Math.floor(phase)];
      const w2 = grainWindow[Math.floor(phase2)];
      
      outL[i] = delayBufferL[readIndex1] * w1 + delayBufferL[readIndex2] * w2;
      outR[i] = delayBufferR[readIndex1] * w1 + delayBufferR[readIndex2] * w2;
      
      writeIndex = (writeIndex + 1) % 65536;
    }
  };
  
  input.connect(node);
  node.connect(output);
  
  return {
    input,
    output,
    setPitch: (p) => {
      currentPitch = Number(p) || 0;
    }
  };
}

// ── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [accounts, setAccounts] = useState([]);
  const [globalTrackingTarget, setGlobalTrackingTarget] = useState(null);
  const [connected, setConnected] = useState(false);

  const [tokenInput, setTokenInput] = useState('');
  const [tokenNotice, setTokenNotice] = useState(null);
  const [channelId, setChannelId] = useState('');
  const [targetIdInput, setTargetIdInput] = useState('');

  const [selfDeaf, setSelfDeaf] = useState(() => JSON.parse(localStorage.getItem('as_selfDeaf') ?? 'false'));
  const [selfMute, setSelfMute] = useState(false);
  const [stereo, setStereo] = useState(() => JSON.parse(localStorage.getItem('as_stereo') ?? 'true'));
  const [status, setStatus] = useState(() => localStorage.getItem('as_status') ?? 'online');
  const [stereoWidth, setStereoWidth] = useState(1.5);
  const [gain, setGain] = useState(() => Number(localStorage.getItem('as_gain') ?? 2.5));
  const [bass, setBass] = useState(() => Number(localStorage.getItem('as_bass') ?? 9));
  const [treble, setTreble] = useState(() => Number(localStorage.getItem('as_treble') ?? 0));
  const [hz, setHz] = useState(() => Number(localStorage.getItem('as_hz') ?? 48000));
  
  // FX states
  const [autoPan, setAutoPan] = useState(() => JSON.parse(localStorage.getItem('as_autoPan') ?? 'false'));
  const [autoPanSpeed, setAutoPanSpeed] = useState(() => Number(localStorage.getItem('as_autoPanSpeed') ?? 0.5));
  const [bassLimit, setBassLimit] = useState(() => JSON.parse(localStorage.getItem('as_bassLimit') ?? 'false'));
  const [reverb, setReverb] = useState(() => Number(localStorage.getItem('as_reverb') ?? 0));
  const [manualPan, setManualPan] = useState(() => Number(localStorage.getItem('as_manualPan') ?? 0));
  const [panWidth, setPanWidth] = useState(() => Number(localStorage.getItem('as_panWidth') ?? 1));

  // G Delay & Mic Pitch Shifter states
  const [gDelay, setGDelay] = useState(() => JSON.parse(localStorage.getItem('as_gDelay') ?? 'false'));
  const [gDelayTime, setGDelayTime] = useState(() => Number(localStorage.getItem('as_gDelayTime') ?? 0.3));
  const [gDelayFeedback, setGDelayFeedback] = useState(() => Number(localStorage.getItem('as_gDelayFeedback') ?? 0.4));
  const [micPitch, setMicPitch] = useState(() => Number(localStorage.getItem('as_micPitch') ?? 0));

  // Music effects (Pitch Shifter, Bass Boost, Reverb, Hz Overdrive, Dominance, 8D, Normal Volume, EQ)
  const [musicPitch, setMusicPitch] = useState(0);
  const [musicReverb, setMusicReverb] = useState(0);
  const [musicBass, setMusicBass] = useState(0);
  const [musicHz, setMusicHz] = useState(48000);
  const [musicDominance, setMusicDominance] = useState(true);
  const [musicClarity, setMusicClarity] = useState(false);
  const [musicNormalVolume, setMusicNormalVolume] = useState(() => Number(localStorage.getItem('as_musicNormalVolume') ?? 100));
  const [music8D, setMusic8D] = useState(() => JSON.parse(localStorage.getItem('as_music8D') ?? 'false'));
  const [music8DSpeed, setMusic8DSpeed] = useState(() => Number(localStorage.getItem('as_music8DSpeed') ?? 0.125));
  const [musicEqEnabled, setMusicEqEnabled] = useState(() => JSON.parse(localStorage.getItem('as_musicEqEnabled') ?? 'false'));
  const [musicEq, setMusicEq] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('as_musicEq') || '{"sub":0,"bass":0,"mid":0,"highMid":0,"treble":0}');
    } catch(e) {
      return { sub: 0, bass: 0, mid: 0, highMid: 0, treble: 0 };
    }
  });
  const [jammerActive, setJammerActive] = useState(false);

  // Yeni Ses Özellikleri & Çarpanları
  const [voiceMultiplier, setVoiceMultiplier] = useState(1.0); // 1x - 5000x Digital Gain
  const [soundMultiplier, setSoundMultiplier] = useState(1);   // 1x - 100x Overlay Layers
  const [hellMode, setHellMode] = useState(false);             // Cehennem Modu (Dragon Mode)
  const [legendMode, setLegendMode] = useState(false);         // 👑 LEGEND MODE (1v1 APEX DOMINATOR)
  const [multiHarmonicDistortion, setMultiHarmonicDistortion] = useState(false); // ⚡ Multi-Harmonic Distortion
  const [harmonicExciter, setHarmonicExciter] = useState(false);
  const [harmonicIntensity, setHarmonicIntensity] = useState(0.5);
  const [noiseGate, setNoiseGate] = useState(false);
  const [sampleRateManipulator, setSampleRateManipulator] = useState(false);
  const [manipulatorRate, setManipulatorRate] = useState(192000);
  const [vstPlugins, setVstPlugins] = useState([]);
  const [copiedToken, setCopiedToken] = useState(null);
  const [consoleLogs, setConsoleLogs] = useState([
    { id: '1', time: new Date().toLocaleTimeString('tr-TR', { hour12: false }), category: 'SYSTEM', message: 'Dragon Service Ses & 20ms Senkron Motoru Hazır.', type: 'info' }
  ]);
  const [consoleFilter, setConsoleFilter] = useState('all');
  const [micStatus, setMicStatus] = useState('Bağlanıyor...');
  const [micError, setMicError] = useState(null);
  const consoleEndRef = useRef(null);

  // Temiz Ses Güçlendirme & Netleştirme Kontrolleri
  const [voiceBooster, setVoiceBooster] = useState(() => JSON.parse(localStorage.getItem('as_voiceBooster') ?? 'false'));
  const [voiceBoosterGain, setVoiceBoosterGain] = useState(() => Number(localStorage.getItem('as_voiceBoosterGain') ?? 2));
  const [voiceClarity, setVoiceClarity] = useState(() => JSON.parse(localStorage.getItem('as_voiceClarity') ?? 'true'));
  const [voiceCompressor, setVoiceCompressor] = useState(() => JSON.parse(localStorage.getItem('as_voiceCompressor') ?? 'true'));
  const [voiceNoiseGate, setVoiceNoiseGate] = useState(() => JSON.parse(localStorage.getItem('as_voiceNoiseGate') ?? 'false'));

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => localStorage.getItem('as_deviceId') ?? '');
  const [micLevel, setMicLevel] = useState(0);

  // Kamera ve Video Yayın Özellikleri
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(() => localStorage.getItem('as_cameraId') ?? '');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraPreviewActive, setCameraPreviewActive] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraTarget, setCameraTarget] = useState('all'); // 'all' or specific token
  const [streamMirror, setStreamMirror] = useState(false);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);


  const mediaRecorderRef = useRef(null);
  const audioContextRef  = useRef(null);
  const streamRef        = useRef(null);
  const animationRef     = useRef(null);
  const gainNodeRef      = useRef(null);
  const bassNodeRef      = useRef(null);
  const trebleNodeRef    = useRef(null);
  const bassLimiterRef   = useRef(null);
  const pannerNodeRef    = useRef(null);
  const reverbGainRef    = useRef(null);
  const autoPanLFORef    = useRef(null);
  const stereoWidthRef   = useRef(stereoWidth);
  const stereoRef        = useRef(stereo);
  const micPitchShifterRef = useRef(null);
  const pcmProcessorRef  = useRef(null);
  const anyInVoiceRef    = useRef(false);
  const selfMuteRef      = useRef(false);
  const gainRef          = useRef(gain);
  const analyserRef      = useRef(null);
  const fileInputRef     = useRef(null);
  const globalMediaInputRef = useRef(null);
  const accountMediaInputRefs = useRef({});

  const [playbackMode, setPlaybackMode] = useState('global'); // 'global' | 'individual'
  const [globalMediaFilePath, setGlobalMediaFilePath] = useState('');
  const [globalMediaFileName, setGlobalMediaFileName] = useState('');
  const [globalMediaVolumeDb, setGlobalMediaVolumeDb] = useState(0); // up to 50,000,000 dB boost
  const [globalMediaLoop, setGlobalMediaLoop] = useState(true);
  const [globalMediaPlaying, setGlobalMediaPlaying] = useState(false);
  const [globalMediaCurrentTime, setGlobalMediaCurrentTime] = useState(0);
  const [globalMediaDuration, setGlobalMediaDuration] = useState(0);
  const isSeekingRef = useRef(false);

  const [accountMedia, setAccountMedia] = useState({});
  const [accountChannelInputs, setAccountChannelInputs] = useState({});

  const [rpcEnabled, setRpcEnabled] = useState(() => JSON.parse(localStorage.getItem('as_rpcEnabled') ?? 'true'));
  const [rpcName, setRpcName] = useState(() => {
    const saved = localStorage.getItem('as_rpcName');
    if (!saved || saved.toLowerCase().includes('ampse')) {
      localStorage.setItem('as_rpcName', 'Dragon Service');
      return 'Dragon Service';
    }
    return saved;
  });
  const [rpcDetails, setRpcDetails] = useState(() => localStorage.getItem('as_rpcDetails') || '');
  const [rpcState, setRpcState] = useState(() => localStorage.getItem('as_rpcState') || '');
  const [rpcImage, setRpcImage] = useState(() => localStorage.getItem('as_rpcImage') || '');
  const [rpcType, setRpcType] = useState(() => localStorage.getItem('as_rpcType') || 'PLAYING');
  const [rpcSavedNotice, setRpcSavedNotice] = useState(false);
  const [platform, setPlatform] = useState(() => localStorage.getItem('as_platform') || 'vr');
  const [platformApplying, setPlatformApplying] = useState(false);

  useEffect(() => {
    localStorage.setItem('as_platform', platform);
  }, [platform]);

  useEffect(() => {
    localStorage.setItem('as_rpcEnabled', JSON.stringify(rpcEnabled));
    localStorage.setItem('as_rpcName', rpcName);
    localStorage.setItem('as_rpcDetails', rpcDetails);
    localStorage.setItem('as_rpcState', rpcState);
    localStorage.setItem('as_rpcImage', rpcImage);
    localStorage.setItem('as_rpcType', rpcType);
  }, [rpcEnabled, rpcName, rpcDetails, rpcState, rpcImage, rpcType]);

  // Socket connection status
  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      let activeRpcName = localStorage.getItem('as_rpcName');
      if (!activeRpcName || activeRpcName.toLowerCase().includes('ampse')) {
        activeRpcName = 'Dragon Service';
        localStorage.setItem('as_rpcName', 'Dragon Service');
      }
      const savedRpc = {
        enabled: JSON.parse(localStorage.getItem('as_rpcEnabled') ?? 'true'),
        name: activeRpcName,
        details: localStorage.getItem('as_rpcDetails') || '',
        state: localStorage.getItem('as_rpcState') || '',
        largeImage: localStorage.getItem('as_rpcImage') || '',
        type: localStorage.getItem('as_rpcType') || 'PLAYING'
      };
      socket.emit('update_rpc', savedRpc);
      const savedPlatform = localStorage.getItem('as_platform') || 'vr';
      socket.emit('set_platform', { platform: savedPlatform });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state_update', (data) => {
      setAccounts(data.accounts || []);
      setGlobalTrackingTarget(data.globalTarget || null);
      if (data.platform) {
        setPlatform(data.platform);
      }
      if (data.globalFile) {
        setGlobalMediaPlaying(data.globalFile.playing);
        if (data.globalFile.voiceMultiplier !== undefined) setVoiceMultiplier(data.globalFile.voiceMultiplier);
        if (data.globalFile.soundMultiplier !== undefined) setSoundMultiplier(data.globalFile.soundMultiplier);
        if (data.globalFile.hellMode !== undefined) setHellMode(data.globalFile.hellMode);
        if (data.globalFile.legendMode !== undefined) setLegendMode(data.globalFile.legendMode);
        if (data.globalFile.multiHarmonicDistortion !== undefined) setMultiHarmonicDistortion(data.globalFile.multiHarmonicDistortion);
        if (data.globalFile.harmonicExciter !== undefined) setHarmonicExciter(data.globalFile.harmonicExciter);
        if (data.globalFile.harmonicIntensity !== undefined) setHarmonicIntensity(data.globalFile.harmonicIntensity);
        if (data.globalFile.noiseGate !== undefined) setNoiseGate(data.globalFile.noiseGate);
        if (data.globalFile.sampleRateManipulator !== undefined) setSampleRateManipulator(data.globalFile.sampleRateManipulator);
        if (data.globalFile.manipulatorRate !== undefined) setManipulatorRate(data.globalFile.manipulatorRate);
      }
      if (data.vstPlugins) {
        setVstPlugins(data.vstPlugins);
      }
      if (data.jammerActive !== undefined) {
        setJammerActive(data.jammerActive);
      }
      setConnected(true);
    });
    socket.on('console_log', (logItem) => {
      setConsoleLogs(prev => [...prev.slice(-150), logItem]);
    });
    socket.on('media_time_update', (data) => {
      if (!isSeekingRef.current) {
        setGlobalMediaCurrentTime(data.currentTime || 0);
      }
      if (data.duration !== undefined) {
        setGlobalMediaDuration(data.duration);
      }
      if (data.playing !== undefined) {
        setGlobalMediaPlaying(data.playing);
      }
    });
    socket.on('spotify_status', ({ success, message }) => {});
    socket.on('spotify_track', () => {});
    socket.on('token_feedback', (data) => {
      setTokenNotice(data);
      setTimeout(() => setTokenNotice(null), 4000);
    });

    // Ses aygıtlarını listele ve seç
    refreshDevices();

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('state_update');
      socket.off('console_log');
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
      stopRecording();
    };
  }, []);

  const refreshDevices = async () => {
    try {
      // Önce izin ve cihaz etiketlerini alabilmek için hızlı getUserMedia çağrısı
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(t => t.stop());
      } catch (permErr) {}

      const devs = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devs.filter(d => d.kind === 'audioinput');
      const videoInputs = devs.filter(d => d.kind === 'videoinput');
      setDevices(audioInputs);
      setCameraDevices(videoInputs);

      const saved = localStorage.getItem('as_deviceId');
      const exists = audioInputs.find(d => d.deviceId === saved);
      if (exists) {
        setSelectedDeviceId(saved);
      } else if (audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId);
        localStorage.setItem('as_deviceId', audioInputs[0].deviceId);
      }

      const savedCam = localStorage.getItem('as_cameraId');
      const camExists = videoInputs.find(d => d.deviceId === savedCam);
      if (!camExists && videoInputs.length > 0) {
        setSelectedCameraId(videoInputs[0].deviceId);
        localStorage.setItem('as_cameraId', videoInputs[0].deviceId);
      }
    } catch (err) {
      console.error('Media devices enumeration error:', err);
    }
  };

  // Kamera önizleme başlat
  const startCameraPreview = async (deviceId) => {
    try {
      // Önceki stream'i temizle
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      const constraints = {
        video: deviceId && deviceId !== '' ? { deviceId: { ideal: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
      setCameraPreviewActive(true);
    } catch (err) {
      console.error('Kamera başlatılamadı:', err);
    }
  };

  // Kamera önizleme durdur
  const stopCameraPreview = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraStream(null);
    setCameraPreviewActive(false);
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  // Discord'a kamera aç / kapat
  const toggleCameraOnDiscord = (enabled) => {
    setCameraActive(enabled);
    socket.emit('toggle_camera', {
      token: cameraTarget,
      enabled,
      cameraDevice: cameraDevices.find(d => d.deviceId === selectedCameraId)?.label || 'Webcam'
    });
  };

  // Ekran Paylaşımı (Screen Share / Go Live)
  const handleStartScreenShare = async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });
      cameraStreamRef.current = displayStream;
      setCameraStream(displayStream);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = displayStream;
      }
      setCameraPreviewActive(true);
      toggleCameraOnDiscord(true);
      socket.emit('toggle_stream', { token: cameraTarget, enabled: true, streamName: 'Dragon Live Stream' });

      displayStream.getVideoTracks()[0].onended = () => {
        stopCameraPreview();
        toggleCameraOnDiscord(false);
        socket.emit('toggle_stream', { token: cameraTarget, enabled: false });
      };
    } catch (err) {
      console.error('Ekran paylaşımı hatası:', err);
    }
  };


  const inVoiceCount = accounts.filter(a => a.inVoice).length;
  const anyInVoice = inVoiceCount > 0;

  useEffect(() => {
    anyInVoiceRef.current = anyInVoice;
  }, [anyInVoice]);

  useEffect(() => {
    selfMuteRef.current = selfMute;
  }, [selfMute]);

  useEffect(() => {
    gainRef.current = gain;
  }, [gain]);

  // Mikrofon akışını aygıt veya ses geliştirici ayarları değişince otomatik başlat / güncelle
  useEffect(() => {
    startRecording();
  }, [selectedDeviceId, voiceBooster, voiceBoosterGain, voiceClarity, voiceCompressor, voiceNoiseGate, bassLimit]);

  useEffect(() => {
    stereoRef.current = stereo;
  }, [stereo]);

  // Global user gesture listener to un-suspend AudioContext on any interaction
  useEffect(() => {
    const resumeContext = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('click', resumeContext);
    window.addEventListener('keydown', resumeContext);
    window.addEventListener('touchstart', resumeContext);
    return () => {
      window.removeEventListener('click', resumeContext);
      window.removeEventListener('keydown', resumeContext);
      window.removeEventListener('touchstart', resumeContext);
    };
  }, []);

  useEffect(() => {
    if (anyInVoice) {
      socket.emit('update_voice_states', { selfDeaf, selfMute });
    }
  }, [selfDeaf, selfMute, anyInVoice]);

  useEffect(() => {
    if (accounts.length > 0) {
      socket.emit('update_status', { status });
    }
  }, [status, accounts.length]);

  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      const targetGain = selfMute ? 0 : Number(gain);
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.01);
    }
  }, [gain, selfMute]);

  // Stereo width değişince live güncelle — restart gerekmez
  useEffect(() => {
    stereoWidthRef.current = stereoWidth;
  }, [stereoWidth]);

  // Ayarları localStorage'a kaydet
  useEffect(() => { localStorage.setItem('as_gain', gain); }, [gain]);
  useEffect(() => { localStorage.setItem('as_bass', bass); }, [bass]);
  useEffect(() => { localStorage.setItem('as_treble', treble); }, [treble]);
  useEffect(() => { localStorage.setItem('as_hz', hz); }, [hz]);
  useEffect(() => { localStorage.setItem('as_stereo', stereo); }, [stereo]);
  useEffect(() => { localStorage.setItem('as_selfDeaf', selfDeaf); }, [selfDeaf]);
  useEffect(() => { localStorage.setItem('as_status', status); }, [status]);
  useEffect(() => { if (selectedDeviceId) localStorage.setItem('as_deviceId', selectedDeviceId); }, [selectedDeviceId]);
  useEffect(() => { localStorage.setItem('as_voiceBooster', JSON.stringify(voiceBooster)); }, [voiceBooster]);
  useEffect(() => { localStorage.setItem('as_voiceBoosterGain', voiceBoosterGain); }, [voiceBoosterGain]);
  useEffect(() => { localStorage.setItem('as_voiceClarity', JSON.stringify(voiceClarity)); }, [voiceClarity]);
  useEffect(() => { localStorage.setItem('as_voiceCompressor', JSON.stringify(voiceCompressor)); }, [voiceCompressor]);
  useEffect(() => { localStorage.setItem('as_voiceNoiseGate', JSON.stringify(voiceNoiseGate)); }, [voiceNoiseGate]);
  useEffect(() => { localStorage.setItem('as_autoPan', autoPan); }, [autoPan]);
  useEffect(() => { localStorage.setItem('as_autoPanSpeed', autoPanSpeed); }, [autoPanSpeed]);
  useEffect(() => { localStorage.setItem('as_bassLimit', bassLimit); }, [bassLimit]);
  useEffect(() => { localStorage.setItem('as_reverb', reverb); }, [reverb]);
  useEffect(() => { localStorage.setItem('as_manualPan', manualPan); }, [manualPan]);
  useEffect(() => { localStorage.setItem('as_panWidth', panWidth); }, [panWidth]);
  useEffect(() => { localStorage.setItem('as_gDelay', gDelay); }, [gDelay]);
  useEffect(() => { localStorage.setItem('as_gDelayTime', gDelayTime); }, [gDelayTime]);
  useEffect(() => { localStorage.setItem('as_gDelayFeedback', gDelayFeedback); }, [gDelayFeedback]);
  useEffect(() => { localStorage.setItem('as_micPitch', micPitch); }, [micPitch]);
  useEffect(() => { localStorage.setItem('as_musicNormalVolume', musicNormalVolume); }, [musicNormalVolume]);
  useEffect(() => { localStorage.setItem('as_music8D', music8D); }, [music8D]);
  useEffect(() => { localStorage.setItem('as_music8DSpeed', music8DSpeed); }, [music8DSpeed]);
  useEffect(() => { localStorage.setItem('as_musicEqEnabled', musicEqEnabled); }, [musicEqEnabled]);
  useEffect(() => { localStorage.setItem('as_musicEq', JSON.stringify(musicEq)); }, [musicEq]);

  // Live EQ ve FX güncellemeleri — restart gerekmez
  useEffect(() => {
    if (bassNodeRef.current) bassNodeRef.current.gain.value = Number(bass);
  }, [bass]);
  
  useEffect(() => {
    if (trebleNodeRef.current) trebleNodeRef.current.gain.value = Number(treble);
  }, [treble]);
  
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      const targetGain = selfMute ? 0 : Number(gain);
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.01);
    }
  }, [gain, selfMute]);
  
  useEffect(() => {
    if (pannerNodeRef.current && !autoPan) {
      const clampedPan = Math.max(-1, Math.min(1, Number(manualPan) * Number(panWidth)));
      pannerNodeRef.current.pan.setTargetAtTime(clampedPan, audioContextRef.current?.currentTime || 0, 0.01);
    }
  }, [manualPan, panWidth, autoPan]);
  
  useEffect(() => {
    if (reverbGainRef.current) {
      reverbGainRef.current.gain.setTargetAtTime(Number(reverb) / 100, audioContextRef.current?.currentTime || 0, 0.01);
    }
  }, [reverb]);

  // Auto Pan toggle - restart audio chain when changed
  useEffect(() => {
    if (mediaRecorderRef.current && audioContextRef.current) {
      // Stop existing LFO
      if (autoPanLFORef.current) {
        try { autoPanLFORef.current.stop(); } catch(e) {}
        autoPanLFORef.current = null;
      }
      
      if (autoPan && pannerNodeRef.current) {
        // Create new LFO
        const lfo = audioContextRef.current.createOscillator();
        const lfoGain = audioContextRef.current.createGain();
        lfo.frequency.value = Number(autoPanSpeed);
        lfoGain.gain.value = Number(panWidth);
        lfo.connect(lfoGain);
        lfoGain.connect(pannerNodeRef.current.pan);
        lfo.start();
        autoPanLFORef.current = lfo;
        // Reset manual pan when auto pan is enabled
        pannerNodeRef.current.pan.setTargetAtTime(0, audioContextRef.current.currentTime, 0.01);
      } else if (pannerNodeRef.current) {
        // Apply manual pan when auto pan is disabled
        const clampedPan = Math.max(-1, Math.min(1, Number(manualPan) * Number(panWidth)));
        pannerNodeRef.current.pan.setTargetAtTime(clampedPan, audioContextRef.current.currentTime, 0.01);
      }
    }
  }, [autoPan, autoPanSpeed]);

  // Bass Limiter toggle - restart audio chain when changed
  useEffect(() => {
    if (mediaRecorderRef.current) {
      startRecording(); // Restart to rebuild audio chain with/without bass limiter
    }
  }, [bassLimit]);

  const startRecording = async () => {
    stopRecording();
    setMicStatus('Bağlanıyor...');
    setMicError(null);
    try {
      let stream = null;
      if (selectedDeviceId && selectedDeviceId !== 'default') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: selectedDeviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          });
        } catch (e1) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { ideal: selectedDeviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
              }
            });
          } catch (e2) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { ideal: selectedDeviceId } }
              });
            } catch (e3) {
              console.warn('Fallback to standard audio device');
            }
          }
        }
      }

      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          });
        } catch (e4) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      }

      if (!stream) {
        throw new Error('Mikrofon akışı başlatılamadı.');
      }

      streamRef.current = stream;
      setMicStatus('Aktif');
      setMicError(null);

      // Create AudioContext with low-latency hint
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass({ 
        latencyHint: 'interactive'
      });
      audioContextRef.current = audioCtx;
      
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch (e) {}
      }

      // Create audio nodes
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // Main gain control
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = selfMuteRef.current ? 0 : Number(gainRef.current);
      gainNodeRef.current = gainNode;

      // Ses Güçlendirici (Voice Booster Gain Node)
      const boosterGainNode = audioCtx.createGain();
      boosterGainNode.gain.value = voiceBooster ? Number(voiceBoosterGain) : 1.0;

      // Ses Netleştirici (Clarity High-Pass & Vocal Presence Peaking EQ)
      const clarityHighPass = audioCtx.createBiquadFilter();
      clarityHighPass.type = 'highpass';
      clarityHighPass.frequency.value = voiceClarity ? 90 : 20; // 90Hz altındaki titreşim/patlamayı keser

      const clarityPresence = audioCtx.createBiquadFilter();
      clarityPresence.type = 'peaking';
      clarityPresence.frequency.value = 3200; // Vokal parlaklığı & anlaşılırlık
      clarityPresence.gain.value = voiceClarity ? 5 : 0;
      clarityPresence.Q.value = 0.9;

      // Ses Dengeleyici (Dynamics Compressor / Maximizer)
      const compressor = audioCtx.createDynamicsCompressor();
      if (voiceCompressor) {
        compressor.threshold.value = -18;
        compressor.knee.value = 8;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;
      } else {
        compressor.threshold.value = 0;
        compressor.ratio.value = 1;
      }

      // Bass EQ (low shelf)
      const bassEQ = audioCtx.createBiquadFilter();
      bassEQ.type = 'lowshelf';
      bassEQ.frequency.value = 120;
      bassEQ.gain.value = Number(bass);
      bassNodeRef.current = bassEQ;

      // Treble EQ (high shelf)
      const trebleEQ = audioCtx.createBiquadFilter();
      trebleEQ.type = 'highshelf';
      trebleEQ.frequency.value = 8000;
      trebleEQ.gain.value = Number(treble);
      trebleNodeRef.current = trebleEQ;

      // Presence boost
      const presenceEQ = audioCtx.createBiquadFilter();
      presenceEQ.type = 'peaking';
      presenceEQ.frequency.value = 3000;
      presenceEQ.gain.value = 2;
      presenceEQ.Q.value = 0.7;

      // Real-Time Pitch Shifter for Mic
      const pitchShifterNode = createPitchShifterNode(audioCtx, micPitch);
      micPitchShifterRef.current = pitchShifterNode;

      // Bass Limiter (optional)
      let bassLimiterChain = null;
      if (bassLimit) {
        const bassFilter = audioCtx.createBiquadFilter();
        bassFilter.type = 'lowpass';
        bassFilter.frequency.value = 300;
        
        const limiterComp = audioCtx.createDynamicsCompressor();
        limiterComp.threshold.value = -12;
        limiterComp.knee.value = 8;
        limiterComp.ratio.value = 4;
        limiterComp.attack.value = 0.003;
        limiterComp.release.value = 0.2;
        
        bassFilter.connect(limiterComp);
        bassLimiterChain = { input: bassFilter, output: limiterComp };
        bassLimiterRef.current = bassLimiterChain;
      }

      // Reverb setup
      const reverbNode = audioCtx.createConvolver();
      const reverbGain = audioCtx.createGain();
      reverbGain.gain.value = Number(reverb) / 100;
      reverbGainRef.current = reverbGain;
      
      const impulseLength = Math.round(audioCtx.sampleRate * 1.5);
      const impulse = audioCtx.createBuffer(2, impulseLength, audioCtx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < impulseLength; i++) {
          const decay = Math.exp(-i / (audioCtx.sampleRate * 0.3));
          data[i] = (Math.random() * 2 - 1) * decay * 0.5;
        }
      }
      reverbNode.buffer = impulse;

      // Stereo Panner
      const panner = audioCtx.createStereoPanner();
      pannerNodeRef.current = panner;

      if (autoPan) {
        panner.pan.value = 0;
        const lfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        lfo.frequency.value = Number(autoPanSpeed);
        lfoGain.gain.value = Number(panWidth);
        lfo.connect(lfoGain);
        lfoGain.connect(panner.pan);
        lfo.start();
        autoPanLFORef.current = lfo;
      } else {
        const clampedPan = Math.max(-1, Math.min(1, Number(manualPan) * Number(panWidth)));
        panner.pan.value = clampedPan;
      }

      // Dry/Wet split for reverb
      const dryGain = audioCtx.createGain();
      const wetGain = audioCtx.createGain();
      dryGain.gain.value = 1;
      wetGain.gain.value = 1;

      // Final output destination
      const dest = audioCtx.createMediaStreamDestination();

      // Audio Graph Routing:
      source.connect(analyser);
      source.connect(gainNode);
      gainNode.connect(boosterGainNode);
      boosterGainNode.connect(clarityHighPass);
      clarityHighPass.connect(clarityPresence);
      clarityPresence.connect(compressor);
      compressor.connect(bassEQ);
      
      if (bassLimiterChain) {
        bassEQ.connect(bassLimiterChain.input);
        bassLimiterChain.output.connect(trebleEQ);
      } else {
        bassEQ.connect(trebleEQ);
      }
      
      trebleEQ.connect(presenceEQ);
      presenceEQ.connect(pitchShifterNode.input);
      
      pitchShifterNode.output.connect(dryGain);
      pitchShifterNode.output.connect(reverbNode);
      reverbNode.connect(reverbGain);
      reverbGain.connect(wetGain);
      
      dryGain.connect(panner);
      wetGain.connect(panner);

      // Direct Raw PCM Streaming Processor (100% reliable, zero delay)
      const pcmProc = audioCtx.createScriptProcessor(2048, 2, 2);
      pcmProcessorRef.current = pcmProc;
      pcmProc.onaudioprocess = (e) => {
        const inL = e.inputBuffer.getChannelData(0);
        const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
        
        // Transmit over socket when in voice channel and not self muted
        if (anyInVoiceRef.current && !selfMuteRef.current) {
          const isStereo = stereoRef.current !== undefined ? stereoRef.current : stereo;
          const width = Number(stereoWidthRef.current) || 1.5;
          
          const int16 = new Int16Array(inL.length * 2);
          for (let i = 0; i < inL.length; i++) {
            let l = inL[i];
            let r = isStereo ? inR[i] : inL[i];
            
            // Dip Gürültü Filtresi (Noise Gate)
            if (voiceNoiseGate) {
              const amp = Math.abs(l) + Math.abs(r);
              if (amp < 0.015) {
                l = 0;
                r = 0;
              }
            }

            if (isStereo && width !== 1) {
              const mid = (l + r) * 0.5;
              const side = (l - r) * 0.5 * width;
              l = mid + side;
              r = mid - side;
            }
            
            let sL = Math.max(-1, Math.min(1, l));
            let sR = Math.max(-1, Math.min(1, r));
            
            int16[i * 2] = sL < 0 ? Math.round(sL * 32768) : Math.round(sL * 32767);
            int16[i * 2 + 1] = sR < 0 ? Math.round(sR * 32768) : Math.round(sR * 32767);
          }
          
          socket.emit('raw_pcm_chunk', int16.buffer);
        }
      };

      panner.connect(pcmProc);
      
      // Connect pcmProc to silent destination so Web Audio continuously renders
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      pcmProc.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      pcmProc.connect(dest);

      // Mic level meter loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!audioContextRef.current || !analyserRef.current) return;
        try {
          analyserRef.current.getByteFrequencyData(dataArray);
          let maxVal = 0;
          for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxVal) maxVal = dataArray[i];
          }
          const level = Math.min(100, Math.round((maxVal / 255) * 100));
          setMicLevel(level);
        } catch(e) {}
        animationRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Backup MediaRecorder
      try {
        const recorder = new MediaRecorder(dest.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 320000
        });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && anyInVoiceRef.current && !selfMuteRef.current) {
            e.data.arrayBuffer().then(buf => {
              socket.emit('audio_chunk', { chunk: buf });
            });
          }
        };

        recorder.start(200);
        mediaRecorderRef.current = recorder;
      } catch(e) {}
      
    } catch (err) {
      console.error('Error starting recording:', err);
      setMicStatus('Bağlantı Hatası');
      setMicError(err.message || 'Mikrofona erişilemedi.');
    }
  };

  const stopRecording = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setMicLevel(0);
    
    if (pcmProcessorRef.current) {
      try { pcmProcessorRef.current.disconnect(); } catch(e) {}
      pcmProcessorRef.current = null;
    }

    if (micPitchShifterRef.current) {
      try { micPitchShifterRef.current.input.disconnect(); } catch(e) {}
      micPitchShifterRef.current = null;
    }

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== 'inactive') {
        try { 
          mediaRecorderRef.current.stop(); 
        } catch(e) {}
      }
    }
    
    if (autoPanLFORef.current) {
      try { 
        autoPanLFORef.current.stop(); 
      } catch(e) {}
      autoPanLFORef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (audioContextRef.current) {
      try { 
        audioContextRef.current.close(); 
      } catch(e) {}
    }
    
    mediaRecorderRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    bassNodeRef.current = null;
    trebleNodeRef.current = null;
    gainNodeRef.current = null;
    pannerNodeRef.current = null;
    reverbGainRef.current = null;
    bassLimiterRef.current = null;
  };

  const handleAddToken = (e) => {
    e.preventDefault();
    const cleanToken = tokenInput.replace(/^["']|["']$/g, '').trim();
    if (!cleanToken) return;

    if (cleanToken.length < 25 || cleanToken.includes(' ')) {
      setTokenNotice({ type: 'error', message: 'Geçersiz token formatı! Lütfen geçerli bir Discord tokeni girin.' });
      setTimeout(() => setTokenNotice(null), 4000);
      return;
    }

    const alreadyExists = accounts.some(a => a.token === cleanToken && a.status !== 'error');
    if (alreadyExists) {
      setTokenNotice({ type: 'warning', message: 'Bu Token Zaten Ekli !' });
      setTimeout(() => setTokenNotice(null), 3500);
      return;
    }

    socket.emit('add_token', { token: cleanToken });
    setTokenInput('');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result || '';
      const lines = text.split(/\r?\n/);
      const fileTokens = lines
        .map(line => line.replace(/^["']|["']$/g, '').trim())
        .filter(line => line.length >= 25 && !line.includes(' ') && !line.startsWith('#'));

      if (lines.length > 0 && fileTokens.length === 0) {
        setTokenNotice({
          type: 'error',
          message: 'Seçilen dosyada geçerli formatta Discord tokeni bulunamadı!'
        });
        setTimeout(() => setTokenNotice(null), 4000);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const existingTokensSet = new Set(accounts.filter(a => a.status !== 'error').map(a => a.token));
      const newTokens = [];
      let duplicateCount = 0;

      for (const t of fileTokens) {
        if (existingTokensSet.has(t) || newTokens.includes(t)) {
          duplicateCount++;
        } else {
          newTokens.push(t);
        }
      }

      if (newTokens.length > 0) {
        socket.emit('add_tokens', { tokens: newTokens });
        if (duplicateCount > 0) {
          setTokenNotice({
            type: 'warning',
            message: `${newTokens.length} yeni token eklendi. (${duplicateCount} tanesi zaten ekli olduğu için atlandı)`
          });
        } else {
          setTokenNotice({
            type: 'success',
            message: `${newTokens.length} token başarıyla eklendi!`
          });
        }
      } else if (duplicateCount > 0) {
        setTokenNotice({
          type: 'warning',
          message: 'Seçilen dosyadaki tüm tokenlar zaten ekli !'
        });
      }

      setTimeout(() => setTokenNotice(null), 4000);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handlePickGlobalMedia = async () => {
    if (window.electronAPI?.openFileDialog) {
      const selected = await window.electronAPI.openFileDialog({
        filters: [
          { name: 'Media Files', extensions: ['mp3', 'mp4', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'webm', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (selected) {
        setGlobalMediaFilePath(selected);
        const name = selected.split(/[\\/]/).pop();
        setGlobalMediaFileName(name);
      }
    } else {
      globalMediaInputRef.current?.click();
    }
  };

  const handleSelectGlobalMedia = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fullPath = window.electronAPI?.getPathForFile(file) || file.path || file.name;
    setGlobalMediaFilePath(fullPath);
    setGlobalMediaFileName(file.name);
  };

  const handleStartGlobalMedia = () => {
    if (!globalMediaFilePath) return;
    socket.emit('play_global_file', {
      filePath: globalMediaFilePath,
      volumeDb: Number(globalMediaVolumeDb) || 0,
      normalVolume: Number(musicNormalVolume) / 100,
      is8D: music8D,
      speed8D: music8DSpeed,
      eq: { ...musicEq, enabled: musicEqEnabled },
      loop: globalMediaLoop,
      pitch: Number(musicPitch) || 0,
      reverb: Number(musicReverb) || 0,
      bass: Number(musicBass) || 0,
      hz: Number(musicHz) || 48000,
      dominance: musicDominance,
      clarity: musicClarity
    });
  };

  const handleStopGlobalMedia = () => {
    setGlobalMediaPlaying(false);
    setGlobalMediaCurrentTime(0);
    socket.emit('stop_global_file');
  };

  const handlePickAccountMedia = async (token) => {
    if (window.electronAPI?.openFileDialog) {
      const selected = await window.electronAPI.openFileDialog({
        filters: [
          { name: 'Media Files', extensions: ['mp3', 'mp4', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'webm', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (selected) {
        const name = selected.split(/[\\/]/).pop();
        setAccountMedia(prev => ({
          ...prev,
          [token]: {
            ...(prev[token] || {}),
            filePath: selected,
            fileName: name,
            volumeDb: prev[token]?.volumeDb ?? 0,
            loop: prev[token]?.loop ?? true
          }
        }));
      }
    } else {
      accountMediaInputRefs.current[token]?.click();
    }
  };

  const handleSelectAccountMedia = (token, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fullPath = window.electronAPI?.getPathForFile(file) || file.path || file.name;
    setAccountMedia(prev => ({
      ...prev,
      [token]: {
        ...(prev[token] || {}),
        filePath: fullPath,
        fileName: file.name,
        volumeDb: prev[token]?.volumeDb ?? 0,
        loop: prev[token]?.loop ?? true
      }
    }));
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSeekGlobalMedia = (newTime) => {
    setGlobalMediaCurrentTime(newTime);
    socket.emit('seek_global_file', { seconds: newTime });
  };

  const handleLiveGlobalVolume = (newDb) => {
    setGlobalMediaVolumeDb(newDb);
    socket.emit('set_global_volume', { volumeDb: newDb });
  };

  const handleLiveAccountVolume = (token, newDb) => {
    setAccountMedia(prev => ({
      ...prev,
      [token]: { ...(prev[token] || {}), volumeDb: newDb }
    }));
    socket.emit('set_account_volume', { token, volumeDb: newDb });
  };

  const handleStartAccountMedia = (token) => {
    const media = accountMedia[token];
    if (!media || !media.filePath) return;
    socket.emit('play_account_file', {
      token,
      filePath: media.filePath,
      volumeDb: Number(media.volumeDb) || 0,
      loop: media.loop ?? true
    });
  };

  const handleStopAccountMedia = (token) => {
    socket.emit('stop_account_file', { token });
  };

  const handleJoinSingleVoice = (token) => {
    const targetChannel = (accountChannelInputs[token] || channelId || '').trim();
    if (!targetChannel) return;
    socket.emit('join_voice_account', {
      token,
      channelId: targetChannel,
      options: { selfDeaf, selfMute }
    });
  };

  const handleDisconnectSingleVoice = (token) => {
    socket.emit('disconnect_voice_account', { token });
  };

  const handleApplyRPC = () => {
    socket.emit('update_rpc', {
      enabled: rpcEnabled,
      name: rpcName,
      details: rpcDetails,
      state: rpcState,
      largeImage: rpcImage,
      type: rpcType
    });
    setRpcSavedNotice(true);
    setTimeout(() => setRpcSavedNotice(false), 2000);
  };

  const handlePlatformChange = (newPlatform, reconnect = false) => {
    setPlatform(newPlatform);
    localStorage.setItem('as_platform', newPlatform);
    if (reconnect) {
      setPlatformApplying(true);
      socket.emit('set_platform', { platform: newPlatform, reconnectAll: true });
      setTimeout(() => setPlatformApplying(false), 2000);
    } else {
      socket.emit('set_platform', { platform: newPlatform });
    }
  };

  const handleRemoveToken = (token) => socket.emit('remove_token', { token });

  const handleJoinVoiceAll = async () => {
    if (!channelId || accounts.length === 0) return;
    
    // Trigger user interaction for AudioContext (production fix)
    try {
      const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
      await tempCtx.resume();
      tempCtx.close();
    } catch (e) {
      console.log('[Audio] Pre-activation failed, but continuing...');
    }
    
    socket.emit('join_voice_all', {
      channelId: channelId.trim(),
      options: { selfDeaf, selfMute }
    });
  };

  const handleDisconnectVoiceAll = () => {
    socket.emit('disconnect_voice_all');
    stopRecording();
  };

  const handleFollowUser = async () => {
    if (!targetIdInput.trim() || accounts.length === 0) return;
    
    // Trigger user interaction for AudioContext (production fix)
    try {
      const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
      await tempCtx.resume();
      tempCtx.close();
    } catch (e) {
      console.log('[Audio] Pre-activation failed, but continuing...');
    }
    
    socket.emit('follow_user', {
      targetId: targetIdInput.trim(),
      options: { selfDeaf, selfMute }
    });
  };

  const handleVstLoad = async () => {
    if (window.electronAPI?.openFileDialog) {
      const filePath = await window.electronAPI.openFileDialog({
        filters: [{ name: 'VST Plugins (*.dll, *.vst3)', extensions: ['dll', 'vst3'] }]
      });
      if (filePath) {
        socket.emit('vst_load', { filePath });
      }
    }
  };

  const handleVstRemove = (slotIndex) => {
    socket.emit('vst_remove', { slotIndex });
  };

  const handleVstToggleBypass = (slotIndex, bypassed) => {
    socket.emit('vst_toggle_bypass', { slotIndex, bypassed });
  };

  const handleVstSetGain = (slotIndex, gain) => {
    socket.emit('vst_set_gain', { slotIndex, gain });
  };

  const handleVoiceMultiplierChange = (val) => {
    setVoiceMultiplier(val);
    socket.emit('set_voice_multiplier', { multiplier: val });
  };

  const handleSoundMultiplierChange = (val) => {
    setSoundMultiplier(val);
    socket.emit('set_sound_multiplier', { multiplier: val });
  };

  const handleLegendModeToggle = () => {
    const next = !legendMode;
    setLegendMode(next);
    socket.emit('set_legend_mode', { enabled: next });
  };

  const handleMultiHarmonicDistortionToggle = () => {
    const next = !multiHarmonicDistortion;
    setMultiHarmonicDistortion(next);
    socket.emit('set_multi_harmonic_distortion', { enabled: next });
  };

  const handleHellModeToggle = () => {
    const next = !hellMode;
    setHellMode(next);
    socket.emit('set_hell_mode', { enabled: next });
  };

  const handleHarmonicExciterToggle = () => {
    const next = !harmonicExciter;
    setHarmonicExciter(next);
    socket.emit('set_harmonic_exciter', { enabled: next, intensity: harmonicIntensity });
  };

  const handleHarmonicIntensityChange = (val) => {
    setHarmonicIntensity(val);
    socket.emit('set_harmonic_exciter', { enabled: harmonicExciter, intensity: val });
  };

  const handleNoiseGateToggle = () => {
    const next = !noiseGate;
    setNoiseGate(next);
    socket.emit('set_noise_gate', { enabled: next });
  };

  const handleSampleRateManipulatorToggle = () => {
    const next = !sampleRateManipulator;
    setSampleRateManipulator(next);
    socket.emit('set_sample_rate_manipulator', { enabled: next, rate: manipulatorRate });
  };

  const handleManipulatorRateChange = (rate) => {
    setManipulatorRate(rate);
    socket.emit('set_sample_rate_manipulator', { enabled: sampleRateManipulator, rate });
  };

  const handleClearLogs = () => {
    setConsoleLogs([]);
    socket.emit('clear_logs');
  };

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs]);

  const onlineCount = accounts.filter(a => a.status === 'connected').length;
  const voiceCount  = accounts.filter(a => a.inVoice).length;

  return (
    <div className="shell">
      <TitleBar />

      <div className="app-body">
        <div className="app-container">

          {/* ── Header ── */}
          <header className="header">
            <div className="header-brand">
              <div className="brand-icon">
                <Radio size={22} color="white" />
              </div>
              <div className="brand-text">
                <h1>Dragon Service</h1>
                <div className="tagline">Multi-Account Voice Client</div>
              </div>
            </div>

            <div className="header-stats">
              <div className={`stat-chip ${connected ? 'online' : ''}`}>
                <div className="dot" />
                {connected ? 'Connected' : 'Disconnected'}
              </div>
              <div className={`stat-chip ${onlineCount > 0 ? 'online' : ''}`}>
                <div className="dot" style={{ background: onlineCount > 0 ? 'var(--success)' : undefined }} />
                {onlineCount} Account{onlineCount !== 1 ? 's' : ''}
              </div>
              {voiceCount > 0 && (
                <div className="stat-chip voice">
                  <div className="dot" />
                  {voiceCount} In Voice
                </div>
              )}
            </div>
          </header>

          {/* ── Tracking Banner ── */}
          {globalTrackingTarget && (
            <div className="tracking-banner">
              <div className="tracking-banner-left">
                <div className="tracking-pulse" />
                <div className="tracking-info">
                  <strong>
                    <Target size={13} style={{ display:'inline', verticalAlign:'middle', marginRight:5 }} />
                    Following Target: {globalTrackingTarget}
                  </strong>
                  <span>All accounts monitoring — will mirror voice movements automatically</span>
                </div>
              </div>
              <button className="btn-danger" onClick={() => socket.emit('stop_follow')}>
                <Square size={14} /> Stop
              </button>
            </div>
          )}

          {/* ── Dashboard Grid ── */}
          <div className="dashboard-grid">

            {/* LEFT DOCK: Soundpad & Medya Oynatıcı + Akustik Çarpanlar + VST + FX */}
            <div className="left-dock">

              {/* Media Player Panel */}
              <div className="panel">
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Music size={14} /> Soundpad & Medya Oynatıcı (MP3 / MP4 / WAV)
                  </span>
                  <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 2 }}>
                    <button
                      type="button"
                      onClick={() => setPlaybackMode('global')}
                      style={{
                        padding: '3px 8px', fontSize: '0.7rem', fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: playbackMode === 'global' ? 'var(--primary, #6366f1)' : 'transparent',
                        color: playbackMode === 'global' ? '#fff' : 'var(--text-3)'
                      }}
                    >
                      Ortak (Tüm Hesaplar)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaybackMode('individual')}
                      style={{
                        padding: '3px 8px', fontSize: '0.7rem', fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: playbackMode === 'individual' ? 'var(--primary, #6366f1)' : 'transparent',
                        color: playbackMode === 'individual' ? '#fff' : 'var(--text-3)'
                      }}
                    >
                      Her Hesaba Özel
                    </button>
                  </div>
                </div>

                {playbackMode === 'global' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    <input
                      type="file"
                      accept="audio/*,video/*,.mp3,.mp4,.wav,.ogg,.flac,.m4a,.aac,.webm,.mkv"
                      ref={globalMediaInputRef}
                      onChange={handleSelectGlobalMedia}
                      style={{ display: 'none' }}
                    />
                    
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={handlePickGlobalMedia}
                        style={{ padding: '8px 14px', fontSize: '0.8rem', flexShrink: 0 }}
                      >
                        <FileAudio size={14} /> Dosya Seç (MP3/MP4/WAV)
                      </button>
                      <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 6, fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: globalMediaFileName ? '#a5b4fc' : 'var(--text-3)' }}>
                        {globalMediaFileName || 'Henüz dosya seçilmedi...'}
                      </div>
                    </div>

                    {/* Interactive Song Progress & Seek Bar */}
                    <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: '0.75rem', color: '#a5b4fc', fontFamily: 'monospace' }}>
                        <span>{formatTime(globalMediaCurrentTime)}</span>
                        <span>{globalMediaDuration > 0 ? formatTime(globalMediaDuration) : '--:--'}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={globalMediaDuration > 0 ? globalMediaDuration : 100}
                        step="0.5"
                        value={globalMediaCurrentTime}
                        onMouseDown={() => { isSeekingRef.current = true; }}
                        onTouchStart={() => { isSeekingRef.current = true; }}
                        onChange={e => setGlobalMediaCurrentTime(Number(e.target.value))}
                        onMouseUp={e => {
                          isSeekingRef.current = false;
                          handleSeekGlobalMedia(Number(e.target.value));
                        }}
                        onTouchEnd={e => {
                          isSeekingRef.current = false;
                          handleSeekGlobalMedia(globalMediaCurrentTime);
                        }}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#6366f1' }}
                      />
                    </div>

                    {/* Standard PC-like Normal Volume Slider (0% - 100%) */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="gain-label" style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Volume2 size={14} /> Normal Ses Seviyesi (Bilgisayar %):
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: '#38bdf8', fontSize: '0.85rem', fontWeight: 800 }}>%{musicNormalVolume}</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={musicNormalVolume}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setMusicNormalVolume(val);
                          socket.emit('set_global_normal_volume', { normalVolume: val / 100 });
                        }}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#38bdf8', marginBottom: 6 }}
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { pct: 0, label: '%0 (Sessiz)' },
                          { pct: 25, label: '%25' },
                          { pct: 50, label: '%50' },
                          { pct: 75, label: '%75' },
                          { pct: 100, label: '%100 (Tam)' }
                        ].map(p => (
                          <button
                            key={p.pct}
                            type="button"
                            onClick={() => {
                              setMusicNormalVolume(p.pct);
                              socket.emit('set_global_normal_volume', { normalVolume: p.pct / 100 });
                            }}
                            style={{
                              flex: 1,
                              padding: '3px 6px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              borderRadius: 4,
                              cursor: 'pointer',
                              background: musicNormalVolume === p.pct ? '#38bdf8' : 'rgba(255,255,255,0.06)',
                              color: musicNormalVolume === p.pct ? '#000' : 'var(--text-3)',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 8D Audio (360° Dönen Müzik) */}
                    <div style={{
                      background: music8D ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(59, 130, 246, 0.08))' : 'rgba(255,255,255,0.03)',
                      padding: 10,
                      borderRadius: 8,
                      border: music8D ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(255,255,255,0.05)',
                      transition: 'all 0.2s ease'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: music8D ? '#c084fc' : 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Headphones size={14} color={music8D ? '#c084fc' : undefined} /> 8D Ses (360° Dönen Müzik / Binaural)
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>
                            {music8D ? `${(1 / music8DSpeed).toFixed(1)} saniyede bir 360° döner` : 'Kulaklıklarda sağdan sola dönen sinematik 8D ses efekti'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !music8D;
                            setMusic8D(next);
                            socket.emit('set_global_8d', { enabled: next, speed: music8DSpeed });
                          }}
                          style={{
                            padding: '4px 12px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            borderRadius: 6,
                            cursor: 'pointer',
                            border: 'none',
                            background: music8D ? 'linear-gradient(135deg, #a855f7, #6366f1)' : 'rgba(255,255,255,0.1)',
                            color: '#fff',
                            boxShadow: music8D ? '0 0 10px rgba(168, 85, 247, 0.4)' : 'none'
                          }}
                        >
                          {music8D ? '8D AKTİF' : '8D KAPALI'}
                        </button>
                      </div>
                      {music8D && (
                        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="gain-label" style={{ marginBottom: 4 }}>
                            <span style={{ fontSize: '0.72rem', color: '#c084fc' }}>Dönüş Hızı (Rotation Speed):</span>
                            <span style={{ fontSize: '0.72rem', color: '#c084fc', fontWeight: 700 }}>{music8DSpeed} Hz ({(1 / music8DSpeed).toFixed(1)}s / tur)</span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="0.50"
                            step="0.025"
                            value={music8DSpeed}
                            onChange={e => {
                              const val = Number(e.target.value);
                              setMusic8DSpeed(val);
                              socket.emit('set_global_8d', { enabled: music8D, speed: val });
                            }}
                            style={{ width: '100%', cursor: 'pointer', accentColor: '#c084fc', marginBottom: 4 }}
                          />
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {[
                              { speed: 0.05, label: 'Çok Yavaş (20s)' },
                              { speed: 0.08, label: 'Yavaş (12s)' },
                              { speed: 0.125, label: 'Standart 8D (8s)' },
                              { speed: 0.25, label: 'Hızlı (4s)' },
                              { speed: 0.40, label: 'Turbo (2.5s)' }
                            ].map(p => (
                              <button
                                key={p.speed}
                                type="button"
                                onClick={() => {
                                  setMusic8DSpeed(p.speed);
                                  socket.emit('set_global_8d', { enabled: music8D, speed: p.speed });
                                }}
                                style={{
                                  padding: '2px 6px', fontSize: '0.62rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer',
                                  background: music8DSpeed === p.speed ? '#c084fc' : 'rgba(255,255,255,0.06)',
                                  color: music8DSpeed === p.speed ? '#000' : 'var(--text-3)',
                                  border: '1px solid rgba(255,255,255,0.1)'
                                }}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Multi-Band Equalizer (5-Bant EQ) */}
                    <div style={{
                      background: musicEqEnabled ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(249, 115, 22, 0.05))' : 'rgba(255,255,255,0.03)',
                      padding: 10,
                      borderRadius: 8,
                      border: musicEqEnabled ? '1px solid rgba(234, 179, 8, 0.35)' : '1px solid rgba(255,255,255,0.05)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: musicEqEnabled ? '#facc15' : 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Sliders size={14} color={musicEqEnabled ? '#facc15' : undefined} /> Şarkı Ekolayzırı (5-Bant EQ)
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>
                            Frekans bantlarını özelleştir veya hazır önayarları kullan.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !musicEqEnabled;
                            setMusicEqEnabled(next);
                            socket.emit('set_global_eq', { eq: { ...musicEq, enabled: next } });
                          }}
                          style={{
                            padding: '4px 12px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            borderRadius: 6,
                            cursor: 'pointer',
                            border: 'none',
                            background: musicEqEnabled ? 'linear-gradient(135deg, #eab308, #f97316)' : 'rgba(255,255,255,0.1)',
                            color: '#fff',
                            boxShadow: musicEqEnabled ? '0 0 10px rgba(234, 179, 8, 0.35)' : 'none'
                          }}
                        >
                          {musicEqEnabled ? 'EQ AKTİF' : 'EQ KAPALI'}
                        </button>
                      </div>

                      {/* Equalizer Bands & Presets */}
                      {musicEqEnabled && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          {/* Preset buttons */}
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                            {[
                              { name: 'Düz (Flat)', eq: { sub: 0, bass: 0, mid: 0, highMid: 0, treble: 0 } },
                              { name: 'Bass Boost', eq: { sub: 10, bass: 7, mid: -2, highMid: 2, treble: 4 } },
                              { name: 'Vocal / Pop', eq: { sub: -2, bass: 2, mid: 6, highMid: 5, treble: 3 } },
                              { name: 'Rock / Metal', eq: { sub: 6, bass: 4, mid: -3, highMid: 4, treble: 7 } },
                              { name: 'Electronic / Rave', eq: { sub: 9, bass: 8, mid: -1, highMid: 3, treble: 8 } },
                              { name: 'Treble Crisp', eq: { sub: -4, bass: -2, mid: 1, highMid: 6, treble: 10 } }
                            ].map(preset => (
                              <button
                                key={preset.name}
                                type="button"
                                onClick={() => {
                                  setMusicEq(preset.eq);
                                  socket.emit('set_global_eq', { eq: { ...preset.eq, enabled: true } });
                                }}
                                style={{
                                  padding: '3px 8px', fontSize: '0.65rem', fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                                  background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)', border: '1px solid rgba(255,255,255,0.1)'
                                }}
                              >
                                {preset.name}
                              </button>
                            ))}
                          </div>

                          {/* 5 Band Sliders */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                            {[
                              { key: 'sub', label: '60 Hz', title: 'Sub-Bass' },
                              { key: 'bass', label: '250 Hz', title: 'Bass' },
                              { key: 'mid', label: '1 kHz', title: 'Mid' },
                              { key: 'highMid', label: '4 kHz', title: 'High-Mid' },
                              { key: 'treble', label: '12 kHz', title: 'Treble' }
                            ].map(b => (
                              <div key={b.key} style={{ background: 'rgba(0,0,0,0.2)', padding: 6, borderRadius: 6, textAlign: 'center' }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#facc15' }}>{b.label}</div>
                                <div style={{ fontSize: '0.58rem', color: 'var(--text-3)', marginBottom: 4 }}>{b.title}</div>
                                <input
                                  type="range"
                                  min="-15"
                                  max="15"
                                  step="1"
                                  value={musicEq[b.key] || 0}
                                  onChange={e => {
                                    const updated = { ...musicEq, [b.key]: Number(e.target.value) };
                                    setMusicEq(updated);
                                    socket.emit('set_global_eq', { eq: { ...updated, enabled: true } });
                                  }}
                                  style={{ width: '100%', cursor: 'pointer', accentColor: '#facc15' }}
                                />
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: (musicEq[b.key] || 0) > 0 ? '#10b981' : (musicEq[b.key] || 0) < 0 ? '#f43f5e' : 'var(--text-3)', marginTop: 2 }}>
                                  {(musicEq[b.key] || 0) > 0 ? `+${musicEq[b.key]}` : musicEq[b.key] || 0} dB
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Music Pitch Shifter & Reverb Effects */}
                    {/* Music Pitch Shifter & Reverb Effects */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <div className="gain-label">
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>Şarkı Pitch Shifter (Ses Tonu):</span>
                          <span style={{ color: musicPitch === 0 ? 'var(--text-3)' : musicPitch > 0 ? '#38bdf8' : '#f43f5e', fontSize: '0.75rem', fontWeight: 700 }}>
                            {musicPitch === 0 ? 'Normal (0)' : musicPitch > 0 ? `+${musicPitch} (Nightcore / İnce)` : `${musicPitch} (Deep / Kalın)`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={musicPitch}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setMusicPitch(val);
                            socket.emit('set_global_pitch', { pitch: val });
                          }}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#38bdf8', marginBottom: 4 }}
                        />
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {[
                            { val: -6, label: '-6 (Çok Kalın)' },
                            { val: -3, label: '-3 (Kalın)' },
                            { val: -1, label: '-1' },
                            { val: 0, label: '0 (Normal / Sıfırla)' },
                            { val: 1, label: '+1' },
                            { val: 3, label: '+3 (İnce)' },
                            { val: 6, label: '+6 (Nightcore)' }
                          ].map(p => (
                            <button
                              key={p.val}
                              type="button"
                              onClick={() => {
                                setMusicPitch(p.val);
                                socket.emit('set_global_pitch', { pitch: p.val });
                              }}
                              style={{
                                padding: '2px 6px',
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                borderRadius: 4,
                                cursor: 'pointer',
                                background: musicPitch === p.val ? '#38bdf8' : 'rgba(255,255,255,0.06)',
                                color: musicPitch === p.val ? '#000' : 'var(--text-3)',
                                border: '1px solid ' + (musicPitch === p.val ? '#38bdf8' : 'rgba(255,255,255,0.1)')
                              }}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="gain-label">
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a78bfa' }}>Şarkı Reverb (Yankı / Akustik):</span>
                          <span style={{ color: musicReverb > 0 ? '#a78bfa' : 'var(--text-3)', fontSize: '0.75rem', fontWeight: 700 }}>%{musicReverb}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={musicReverb}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setMusicReverb(val);
                            socket.emit('set_global_reverb', { reverb: val });
                          }}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa' }}
                        />
                      </div>

                      <div>
                        <div className="gain-label">
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f59e0b' }}>Şarkı Bass Boost (Bas Seviyesi):</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              min="0"
                              max="50"
                              value={musicBass}
                              onChange={e => {
                                const val = Math.max(0, Math.min(50, Number(e.target.value) || 0));
                                setMusicBass(val);
                                socket.emit('set_global_bass', { bass: val });
                              }}
                              style={{ width: 60, padding: '2px 6px', fontSize: '0.75rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, color: '#f59e0b', textAlign: 'right', fontWeight: 700 }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700 }}>dB</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="50"
                          step="1"
                          value={musicBass}
                          onChange={e => {
                            const val = Math.max(0, Math.min(50, Number(e.target.value) || 0));
                            setMusicBass(val);
                            socket.emit('set_global_bass', { bass: val });
                          }}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#f59e0b', marginBottom: 4 }}
                        />
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {[0, 6, 12, 18, 24, 30, 36, 42, 50].map(preset => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => {
                                setMusicBass(preset);
                                socket.emit('set_global_bass', { bass: preset });
                              }}
                              style={{
                                padding: '2px 6px', fontSize: '0.62rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer',
                                background: musicBass === preset ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                                color: musicBass === preset ? '#000' : 'var(--text-3)',
                                border: '1px solid rgba(255,255,255,0.1)'
                              }}
                            >
                              {preset === 0 ? '0 dB' : `+${preset} dB`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Şarkı Hz (Sample Rate & Frequency Turbo Overdrive) */}
                      <div>
                        <div className="gain-label">
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#06b6d4' }}>Şarkı Hz (Frekans & Örnekleme Hızı):</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              min="100"
                              max="1000000"
                              value={musicHz}
                              onChange={e => {
                                const val = Math.max(100, Math.min(1000000, Number(e.target.value) || 48000));
                                setMusicHz(val);
                                socket.emit('set_global_hz', { hz: val });
                              }}
                              style={{ width: 90, padding: '2px 6px', fontSize: '0.75rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, color: '#06b6d4', textAlign: 'right', fontWeight: 700 }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#06b6d4', fontWeight: 700 }}>Hz</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="8000"
                          max="192000"
                          step="1000"
                          value={Math.min(192000, musicHz)}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setMusicHz(val);
                            socket.emit('set_global_hz', { hz: val });
                          }}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#06b6d4', marginBottom: 4 }}
                        />
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {[
                            { hz: 8000, label: '8k (Bitcrush)' },
                            { hz: 16000, label: '16k' },
                            { hz: 24000, label: '24k' },
                            { hz: 32000, label: '32k' },
                            { hz: 44100, label: '44.1k' },
                            { hz: 48000, label: '48k (Normal)' },
                            { hz: 96000, label: '96k (Hi-Fi)' },
                            { hz: 192000, label: '192k (Ultra)' },
                            { hz: 384000, label: '384k (Overdrive)' },
                            { hz: 768000, label: '768k (Turbo)' },
                            { hz: 1000000, label: '1 MHz (MAX)' }
                          ].map(preset => (
                            <button
                              key={preset.hz}
                              type="button"
                              onClick={() => {
                                setMusicHz(preset.hz);
                                socket.emit('set_global_hz', { hz: preset.hz });
                              }}
                              style={{
                                padding: '2px 6px', fontSize: '0.62rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer',
                                background: musicHz === preset.hz ? '#06b6d4' : 'rgba(255,255,255,0.06)',
                                color: musicHz === preset.hz ? '#000' : 'var(--text-3)',
                                border: '1px solid rgba(255,255,255,0.1)'
                              }}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Dominance & Anti-Muffle (Acoustic Masking / Karşıyı Bastırma) */}
                      <div style={{ marginTop: 2, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: musicDominance ? '#10b981' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <ShieldCheck size={14} /> Apex Dominance & Rakip Yok Edici (Anti-Muffle)
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>
                            1 Kentilyon dB'de boğuklaşmayı önler — 5-bant psikoakustik maskeleme, 107dB soundpad'i de ezer.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !musicDominance;
                            setMusicDominance(next);
                            socket.emit('set_global_dominance', { dominance: next });
                          }}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            borderRadius: 6,
                            cursor: 'pointer',
                            border: 'none',
                            background: musicDominance ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.1)',
                            color: '#fff',
                            boxShadow: musicDominance ? '0 0 10px rgba(16, 185, 129, 0.4)' : 'none',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {musicDominance ? 'AKTİF' : 'KAPALI'}
                        </button>
                      </div>
                    </div>

                    {/* Live Real-Time dB Boost Slider (-80 dB to +500,000,000,000 dB) */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, color: globalMediaVolumeDb < 0 ? '#38bdf8' : '#f43f5e' }}>
                          <Volume2 size={13} /> Canlı Desibel (dB Boost / Kısma):
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            min="-80"
                            max="1000000000000000000"
                            value={globalMediaVolumeDb}
                            onChange={e => {
                              const val = Math.max(-80, Math.min(1000000000000000000, Number(e.target.value) || 0));
                              handleLiveGlobalVolume(val);
                            }}
                            style={{ width: 145, padding: '2px 6px', fontSize: '0.8rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, color: globalMediaVolumeDb < 0 ? '#38bdf8' : '#f43f5e', textAlign: 'right', fontWeight: 700 }}
                          />
                          <span style={{ fontSize: '0.75rem', color: globalMediaVolumeDb < 0 ? '#38bdf8' : '#f43f5e', fontWeight: 700 }}>dB</span>
                        </div>
                      </div>

                      {/* Live Slider (Drag to adjust volume live from -60 dB to +500 dB) */}
                      <input
                        type="range"
                        min="-60"
                        max="500"
                        step="1"
                        value={Math.max(-60, Math.min(500, globalMediaVolumeDb))}
                        onChange={e => handleLiveGlobalVolume(Number(e.target.value))}
                        style={{ width: '100%', marginBottom: 8, cursor: 'pointer', accentColor: globalMediaVolumeDb < 0 ? '#38bdf8' : '#f43f5e' }}
                      />
                      
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {[
                          { db: -60, label: '-60 dB' },
                          { db: -30, label: '-30 dB' },
                          { db: -12, label: '-12 dB' },
                          { db: -6, label: '-6 dB' },
                          { db: 0, label: 'Normal (0dB)' },
                          { db: 10, label: '+10 dB' },
                          { db: 20, label: '+20 dB' },
                          { db: 50, label: '+50 dB' },
                          { db: 100, label: '+100 dB' },
                          { db: 1000, label: '+1.000 dB' },
                          { db: 10000, label: '+10.000 dB' },
                          { db: 100000, label: '+100.000 dB' },
                          { db: 1000000, label: '+1M dB' },
                          { db: 10000000, label: '+10M dB' },
                          { db: 50000000, label: '+50M dB' },
                          { db: 100000000, label: '+100M dB' },
                          { db: 1000000000, label: '+1 Milyar dB' },
                          { db: 10000000000, label: '+10 Milyar dB' },
                          { db: 50000000000, label: '+50 Milyar dB' },
                          { db: 100000000000, label: '+100 Milyar dB' },
                          { db: 500000000000, label: '+500 Milyar dB' },
                          { db: 1000000000000000, label: '+1 Katrilyon dB' },
                          { db: 1000000000000000000, label: '+1 KENTİLYON dB (MAX)' }
                        ].map(preset => (
                          <button
                            key={preset.db}
                            type="button"
                            onClick={() => handleLiveGlobalVolume(preset.db)}
                            style={{
                              padding: '2px 6px', fontSize: '0.62rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer',
                              background: globalMediaVolumeDb === preset.db ? (preset.db < 0 ? '#38bdf8' : '#f43f5e') : 'rgba(255,255,255,0.06)',
                              color: globalMediaVolumeDb === preset.db ? '#000' : 'var(--text-3)',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ses Netleştirme (De-Muffle / Clarity) */}
                    <div style={{ marginTop: 2, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: musicClarity ? '#a78bfa' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Sparkles size={14} /> Ses Netleştirme (De-Muffle / Clarity)
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>
                          Boğuk ve dumanlı sesleri parlatır — mud kes, netlik/hava katmanları ekler.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !musicClarity;
                          setMusicClarity(next);
                          socket.emit('set_global_clarity', { clarity: next });
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          borderRadius: 6,
                          cursor: 'pointer',
                          border: 'none',
                          background: musicClarity ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'rgba(255,255,255,0.1)',
                          color: '#fff',
                          boxShadow: musicClarity ? '0 0 10px rgba(139, 92, 246, 0.4)' : 'none',
                          transition: 'all 0.2s ease',
                          flexShrink: 0
                        }}
                      >
                        {musicClarity ? 'AKTİF' : 'KAPALI'}
                      </button>
                    </div>

                    {/* Voice Channel Jammer & Nuke (Kanalı Sustur & Çökert) */}
                    <div style={{
                      background: jammerActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      padding: 10,
                      borderRadius: 8,
                      border: jammerActive ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      boxShadow: jammerActive ? '0 0 16px rgba(239, 68, 68, 0.35)' : 'none',
                      transition: 'all 0.3s ease'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: jammerActive ? '#ef4444' : '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Zap size={14} /> Ses Kanalını Sustur & Çökert (Voice Jammer / Nuke)
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>
                          8-bantlı nükleer psikoakustik motor — 1 Kentilyon dB, 107dB soundpad dahil tüm sesleri yok eder.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (jammerActive) {
                            socket.emit('stop_voice_jammer');
                          } else {
                            socket.emit('start_voice_jammer');
                          }
                        }}
                        style={{
                          padding: '7px 12px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          borderRadius: 6,
                          cursor: 'pointer',
                          border: 'none',
                          background: jammerActive ? '#ef4444' : 'linear-gradient(135deg, #dc2626, #991b1b)',
                          color: '#fff',
                          boxShadow: '0 0 10px rgba(220, 38, 38, 0.4)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {jammerActive ? 'SUSTURUCUYU DURDUR' : 'KANALI SUSTUR (NUKE)'}
                      </button>
                    </div>

                    {/* Controls */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleStartGlobalMedia}
                        disabled={!globalMediaFilePath}
                        style={{ flex: 1, padding: '9px 12px', background: globalMediaPlaying ? 'var(--success, #10b981)' : 'var(--primary, #6366f1)', opacity: !globalMediaFilePath ? 0.5 : 1 }}
                      >
                        <Play size={14} /> {globalMediaPlaying ? 'Çalıyor (Tekrar Başlat)' : 'Tüm Hesaplarda Başlat'}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={handleStopGlobalMedia}
                        style={{ padding: '9px 14px' }}
                        title="Medyayı Durdur"
                      >
                        <Square size={14} /> Durdur
                      </button>
                      <button
                        type="button"
                        onClick={() => setGlobalMediaLoop(p => !p)}
                        style={{
                          padding: '9px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                          background: globalMediaLoop ? 'rgba(99, 102, 241, 0.2)' : 'rgba(0,0,0,0.2)',
                          color: globalMediaLoop ? '#a5b4fc' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem'
                        }}
                        title="Döngü (Loop)"
                      >
                        <Repeat size={13} /> {globalMediaLoop ? 'Döngü Açık' : 'Döngü Kapalı'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 0', fontSize: '0.8rem', color: 'var(--text-3)', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: '#a5b4fc' }}>
                      <strong>Her Hesaba Özel Mod Aktif:</strong> Aşağıdaki hesap listesinde her bir hesabın kartı üzerinden bağımsız dosya seçip çalabilirsiniz.
                    </p>
                  </div>
                )}
              </div>

              {/* Dragon Mode, Legend Mode & Akustik Çarpanlar */}
              <div className={`panel ${legendMode ? 'legend-mode-active' : hellMode ? 'hell-mode-active' : ''}`}>
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: legendMode ? '#fbbf24' : hellMode ? '#f87171' : undefined }}>
                    <Zap size={15} color={legendMode ? '#f59e0b' : hellMode ? '#ef4444' : '#f87171'} />
                    {legendMode ? 'Legend Mode (1v1 Apex)' : 'Dragon Mode & Akustik Çarpanlar'}
                  </span>
                  {legendMode ? (
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#fbbf24', letterSpacing: 1, textTransform: 'uppercase', animation: 'blink 1s infinite' }}>
                      LEGEND ACTIVE (1v1 APEX)
                    </span>
                  ) : hellMode ? (
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#ef4444', letterSpacing: 1, textTransform: 'uppercase', animation: 'blink 1s infinite' }}>
                      🐉 DRAGON ACTIVE
                    </span>
                  ) : null}
                </div>

                {/* LEGEND MODE (1v1 APEX DOMINATOR) MASTER BUTTON */}
                <div style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={handleLegendModeToggle}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      fontSize: '0.85rem',
                      fontWeight: 900,
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: legendMode ? '2px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.4)',
                      background: legendMode 
                        ? 'linear-gradient(135deg, #f59e0b, #d97706, #92400e)' 
                        : 'rgba(245, 158, 11, 0.12)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      boxShadow: legendMode ? '0 0 24px rgba(245, 158, 11, 0.7)' : 'none',
                      letterSpacing: '0.5px'
                    }}
                  >
                    <Zap size={17} color={legendMode ? '#fff' : '#f59e0b'} />
                    <span>{legendMode ? 'LEGEND MODE DEVREDE (DURDUR)' : 'LEGEND MODE BAŞLAT (1v1 APEX)'}</span>
                  </button>
                </div>

                {/* Dragon Mode Master Button */}
                <button
                  type="button"
                  onClick={handleHellModeToggle}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 900,
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: hellMode ? '2px solid #ef4444' : '1px solid rgba(239, 68, 68, 0.4)',
                    background: hellMode ? 'linear-gradient(135deg, #ef4444, #b91c1c)' : 'rgba(239, 68, 68, 0.15)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: hellMode ? '0 0 20px rgba(239, 68, 68, 0.6)' : 'none',
                    letterSpacing: '0.5px',
                    marginBottom: 12
                  }}
                >
                  <Flame size={16} />
                  {hellMode ? 'DRAGON MODE DEVREDE (DURDUR)' : 'DRAGON MODE BAŞLAT'}
                </button>

                {/* Voice Multiplier (1x - 5000x Digital Gain) */}
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 10 }}>
                  <div className="gain-label" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Zap size={13} /> Voice Multiplier (Şiddet Çarpanı):
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#f59e0b' }}>
                      {voiceMultiplier.toLocaleString()}x Gain
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5000"
                    step="1"
                    value={voiceMultiplier}
                    onChange={e => handleVoiceMultiplierChange(Number(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer', accentColor: '#f59e0b', marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[1, 5, 10, 50, 100, 500, 1000, 2500, 5000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleVoiceMultiplierChange(val)}
                        style={{
                          flex: 1,
                          padding: '2px 4px',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: voiceMultiplier === val ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                          color: voiceMultiplier === val ? '#000' : 'var(--text-3)',
                          border: '1px solid rgba(255,255,255,0.1)'
                        }}
                      >
                        {val}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sound Multiplier (1x - 100x Overlay Layers) */}
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 10 }}>
                  <div className="gain-label" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Layers size={13} /> Sound Multiplier (Katman Bindirme):
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#a855f7' }}>
                      {soundMultiplier} Katman (Overlay)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={soundMultiplier}
                    onChange={e => handleSoundMultiplierChange(Number(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer', accentColor: '#a855f7', marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[1, 2, 5, 10, 20, 50, 75, 100].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleSoundMultiplierChange(val)}
                        style={{
                          flex: 1,
                          padding: '2px 4px',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: soundMultiplier === val ? '#a855f7' : 'rgba(255,255,255,0.06)',
                          color: soundMultiplier === val ? '#fff' : 'var(--text-3)',
                          border: '1px solid rgba(255,255,255,0.1)'
                        }}
                      >
                        {val}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Harmonic Exciter, Multi-Harmonic Distortion, Adaptive Noise Gate & Sample Rate Manipulator Toggles */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Multi-Harmonic Distortion (2.-3.-4. Harmonik Overdrive) */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, border: multiHarmonicDistortion ? '1px solid rgba(236, 72, 153, 0.4)' : '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: multiHarmonicDistortion ? '#ec4899' : 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Sparkles size={13} color={multiHarmonicDistortion ? '#ec4899' : '#a855f7'} /> Multi-Harmonic Distortion (2.-3.-4. Harmonik)
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', marginTop: 2 }}>
                          Yapay üst harmonik distorsiyonu üreterek sesi tüm kulaklık ve hoparlörlerde delip geçer.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleMultiHarmonicDistortionToggle}
                        style={{
                          padding: '3px 9px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          borderRadius: 5,
                          cursor: 'pointer',
                          border: 'none',
                          background: multiHarmonicDistortion ? '#ec4899' : 'rgba(255,255,255,0.1)',
                          color: '#fff',
                          flexShrink: 0
                        }}
                      >
                        {multiHarmonicDistortion ? 'AÇIK' : 'KAPALI'}
                      </button>
                    </div>
                  </div>

                  {/* Harmonic Exciter */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: harmonicExciter ? '#38bdf8' : 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Sparkles size={13} /> Harmonic Exciter (2. & 3. Harmonik)
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', marginTop: 2 }}>
                          Yapay üst harmonik üreterek sesi zenginleştirir ve hacmini genişletir.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleHarmonicExciterToggle}
                        style={{
                          padding: '3px 9px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          borderRadius: 5,
                          cursor: 'pointer',
                          border: 'none',
                          background: harmonicExciter ? '#38bdf8' : 'rgba(255,255,255,0.1)',
                          color: harmonicExciter ? '#000' : '#fff'
                        }}
                      >
                        {harmonicExciter ? 'AÇIK' : 'KAPALI'}
                      </button>
                    </div>
                    {harmonicExciter && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="gain-label" style={{ marginBottom: 2 }}>
                          <span style={{ fontSize: '0.68rem', color: '#38bdf8' }}>Harmonik Yoğunluğu:</span>
                          <span style={{ fontSize: '0.68rem', color: '#38bdf8', fontWeight: 700 }}>%{(harmonicIntensity * 100).toFixed(0)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={harmonicIntensity}
                          onChange={e => handleHarmonicIntensityChange(Number(e.target.value))}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#38bdf8' }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Adaptive Noise Gate (Ters Açı / VAD Kilidi) */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: noiseGate ? '#10b981' : 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ShieldCheck size={13} /> Adaptive Noise Gate (Ters Açı / VAD Kilidi)
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', marginTop: 2 }}>
                        -30dB beyaz gürültü enjekte eder, Discord ses aktivite dedektörünün (VAD) düşmesini engeller.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleNoiseGateToggle}
                      style={{
                        padding: '3px 9px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        borderRadius: 5,
                        cursor: 'pointer',
                        border: 'none',
                        background: noiseGate ? '#10b981' : 'rgba(255,255,255,0.1)',
                        color: noiseGate ? '#000' : '#fff',
                        flexShrink: 0
                      }}
                    >
                      {noiseGate ? 'KİLİTLİ' : 'KAPALI'}
                    </button>
                  </div>

                  {/* Sample Rate Manipulator */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: sampleRateManipulator ? '#c084fc' : 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Disc size={13} /> Sample Rate Manipulator (192 kHz)
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', marginTop: 2 }}>
                          Çıkışı stüdyo kalitesinde 192kHz/384kHz örneklemeye zorlar.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSampleRateManipulatorToggle}
                        style={{
                          padding: '3px 9px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          borderRadius: 5,
                          cursor: 'pointer',
                          border: 'none',
                          background: sampleRateManipulator ? '#c084fc' : 'rgba(255,255,255,0.1)',
                          color: sampleRateManipulator ? '#000' : '#fff',
                          flexShrink: 0
                        }}
                      >
                        {sampleRateManipulator ? 'ZORLA' : 'KAPALI'}
                      </button>
                    </div>
                    {sampleRateManipulator && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {[96000, 192000, 384000].map(rate => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => handleManipulatorRateChange(rate)}
                            style={{
                              flex: 1,
                              padding: '3px 6px',
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              borderRadius: 4,
                              cursor: 'pointer',
                              background: manipulatorRate === rate ? '#c084fc' : 'rgba(255,255,255,0.06)',
                              color: manipulatorRate === rate ? '#000' : 'var(--text-3)',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}
                          >
                            {(rate / 1000)} kHz
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Audio FX */}
              <div className="panel">
                <div className="panel-title"><Settings2 size={14} /> Audio FX & Pan</div>

                <div className="toggles-row">
                  <div className={`toggle-pill${autoPan ? ' active' : ''}`} onClick={() => setAutoPan(p => !p)}>
                    3D Auto Pan
                  </div>
                  <div className={`toggle-pill${bassLimit ? ' active' : ''}`} onClick={() => setBassLimit(p => !p)}>
                    Bass Limit
                  </div>
                </div>

                {autoPan && (
                  <div style={{ marginTop: 10 }}>
                    <div className="gain-label">
                      <span>Pan Speed</span>
                      <span style={{ color: '#a78bfa' }}>{autoPanSpeed.toFixed(2)} Hz</span>
                    </div>
                    <input type="range" min="0.1" max="3" step="0.1" value={autoPanSpeed} onChange={e => setAutoPanSpeed(Number(e.target.value))} />
                  </div>
                )}

                <div className="gain-label" style={{ marginTop: '1rem' }}>
                  <span>Reverb</span>
                  <span style={{ color: reverb > 0 ? '#818cf8' : 'var(--text-3)' }}>{reverb}%</span>
                </div>
                <input type="range" min="0" max="100" step="5" value={reverb} onChange={e => setReverb(Number(e.target.value))} />

                <div className="gain-label" style={{ marginTop: '1rem' }}>
                  <span>Manual Pan</span>
                  <span style={{ color: manualPan === 0 ? 'var(--text-3)' : manualPan < 0 ? '#f472b6' : '#818cf8' }}>
                    {manualPan === 0 ? 'Center' : manualPan < 0 ? `L ${Math.abs(manualPan * 100).toFixed(0)}%` : `R ${(manualPan * 100).toFixed(0)}%`}
                  </span>
                </div>
                <input 
                  type="range" min="-1" max="1" step="0.05" 
                  value={manualPan} 
                  onChange={e => setManualPan(Number(e.target.value))}
                  disabled={autoPan}
                  style={{ opacity: autoPan ? 0.4 : 1 }}
                />

                <div className="gain-label" style={{ marginTop: '0.5rem' }}>
                  <span>Pan Width</span>
                  <span style={{ color: panWidth > 1 ? '#a78bfa' : 'var(--text-3)' }}>{panWidth.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" min="1" max="3" step="0.1" 
                  value={panWidth} 
                  onChange={e => setPanWidth(Number(e.target.value))}
                  disabled={autoPan}
                  style={{ opacity: autoPan ? 0.4 : 1 }}
                />
              </div>

              {/* Camera & Live Stream Panel (Kamera & Yayın Merkezi) */}
              <div className="panel">
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Camera size={14} color="#ef4444" /> Kamera & Canlı Yayın Merkezi
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: cameraActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.06)',
                      color: cameraActive ? '#22c55e' : 'var(--text-3)',
                      border: `1px solid ${cameraActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.1)'}`
                    }}>
                      ● {cameraActive ? 'Kamera Yayında' : 'Kapalı'}
                    </span>
                    <button
                      type="button"
                      onClick={refreshDevices}
                      title="Kameraları Yenile"
                      style={{
                        padding: '3px 6px',
                        fontSize: '0.68rem',
                        borderRadius: 4,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.05)',
                        color: 'var(--text-3)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3
                      }}
                    >
                      <RefreshCw size={11} /> Yenile
                    </button>
                  </div>
                </div>

                {/* Device Selector & Target */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 4, display: 'block' }}>Kamera Kaynağı (Webcam / OBS Virtual Cam):</label>
                    <select
                      value={selectedCameraId}
                      onChange={e => {
                        const id = e.target.value;
                        setSelectedCameraId(id);
                        localStorage.setItem('as_cameraId', id);
                        if (cameraPreviewActive) {
                          startCameraPreview(id);
                        }
                      }}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 6 }}
                    >
                      {cameraDevices.length === 0 ? (
                        <option value="">Aygıt bulunamadı (OBS Virtual Cam / Webcam bağlayın)</option>
                      ) : (
                        cameraDevices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Kamera (${d.deviceId.slice(0, 8)}...)`}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 4, display: 'block' }}>Yayın Hedefi:</label>
                    <select
                      value={cameraTarget}
                      onChange={e => setCameraTarget(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 6 }}
                    >
                      <option value="all">🌐 Tüm Sesteki Hesaplar (Toplu Video)</option>
                      {accounts.filter(a => a.inVoice).map(a => (
                        <option key={a.token} value={a.token}>
                          👤 {a.user?.username || 'Hesap'} ({a.token.slice(0, 10)}...)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Video Live Preview Box */}
                  <div style={{
                    position: 'relative',
                    width: '100%',
                    height: 140,
                    background: '#040508',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <video
                      ref={cameraVideoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: cameraPreviewActive ? 'block' : 'none',
                        transform: streamMirror ? 'scaleX(-1)' : 'none'
                      }}
                    />
                    {!cameraPreviewActive && (
                      <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.72rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <Camera size={24} color="#64748b" />
                        <span>Kamera / Yayın Önizlemesi Kapalı</span>
                      </div>
                    )}
                    {cameraPreviewActive && (
                      <div style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        display: 'flex',
                        gap: 4
                      }}>
                        <button
                          type="button"
                          onClick={() => setStreamMirror(p => !p)}
                          style={{
                            background: 'rgba(0,0,0,0.6)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            color: '#fff',
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontSize: '0.62rem',
                            cursor: 'pointer'
                          }}
                          title="Ayna Görünümü (Yatay Çevir)"
                        >
                          Ayna ({streamMirror ? 'Açık' : 'Kapalı'})
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (cameraPreviewActive) {
                          stopCameraPreview();
                        } else {
                          startCameraPreview(selectedCameraId);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        borderRadius: 6,
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: cameraPreviewActive ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)',
                        color: cameraPreviewActive ? '#a5b4fc' : '#cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5
                      }}
                    >
                      {cameraPreviewActive ? <EyeOff size={13} /> : <Eye size={13} />}
                      {cameraPreviewActive ? 'Önizlemeyi Kapat' : 'Kamera Önizle'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const nextState = !cameraActive;
                        if (nextState && !cameraPreviewActive) {
                          startCameraPreview(selectedCameraId);
                        }
                        toggleCameraOnDiscord(nextState);
                      }}
                      style={{
                        padding: '8px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        borderRadius: 6,
                        cursor: 'pointer',
                        border: 'none',
                        background: cameraActive ? '#22c55e' : 'linear-gradient(135deg, #ef4444, #dc2626)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                        boxShadow: cameraActive ? '0 0 12px rgba(34, 197, 94, 0.4)' : '0 0 10px rgba(239, 68, 68, 0.3)'
                      }}
                    >
                      {cameraActive ? <VideoOff size={13} /> : <Video size={13} />}
                      {cameraActive ? 'Kamerayı Kapat' : 'Kamerayı Aç (Discord)'}
                    </button>
                  </div>

                  {/* Screen Share / Go Live Master Button */}
                  <button
                    type="button"
                    onClick={handleStartScreenShare}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: '1px solid rgba(168, 85, 247, 0.4)',
                      background: 'linear-gradient(135deg, #9333ea, #7e22ce)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxShadow: '0 0 12px rgba(147, 51, 234, 0.3)'
                    }}
                  >
                    <Cast size={14} />
                    Ekran Yayını Başlat (Screen Share / Go Live)
                  </button>
                </div>
              </div>

            </div>

            {/* RIGHT: MAIN COLUMN (Accounts + Controls + Console) */}
            <div className="main-col">

              {/* Add Token */}
              <div className="panel">
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={14} /> Add Account
                  </span>
                  <input
                    type="file"
                    accept=".txt"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ flexShrink: 0, padding: '5px 12px', fontSize: '0.75rem', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.4)', color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 6, borderRadius: '6px', cursor: 'pointer' }}
                    title="TXT dosyasından alt alta yazılmış tokenları toplu yükle"
                  >
                    <FileText size={13} /> Toplu Ekle (.txt)
                  </button>
                </div>
                <form className="add-token-form" onSubmit={handleAddToken}>
                  <input
                    type="password"
                    placeholder="Paste Discord token here..."
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                  />
                  <button type="submit" className="btn" style={{ flexShrink:0 }}>
                    <Plus size={15} /> Add
                  </button>
                </form>
                {tokenNotice && (
                  <div style={{
                    marginTop: 8,
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: tokenNotice.type === 'error' ? 'rgba(239, 68, 68, 0.15)' :
                                tokenNotice.type === 'warning' ? 'rgba(245, 158, 11, 0.15)' :
                                tokenNotice.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                    color: tokenNotice.type === 'error' ? '#f87171' :
                           tokenNotice.type === 'warning' ? '#fbbf24' :
                           tokenNotice.type === 'success' ? '#34d399' : '#a5b4fc',
                    border: `1px solid ${tokenNotice.type === 'error' ? 'rgba(239, 68, 68, 0.4)' :
                                         tokenNotice.type === 'warning' ? 'rgba(245, 158, 11, 0.35)' :
                                         tokenNotice.type === 'success' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(99, 102, 241, 0.35)'}`
                  }}>
                    {tokenNotice.type === 'error' && <AlertTriangle size={15} color="#f87171" />}
                    {tokenNotice.type === 'warning' && <AlertTriangle size={15} color="#fbbf24" />}
                    {tokenNotice.type === 'success' && <Check size={15} color="#34d399" />}
                    <span>{tokenNotice.message || tokenNotice.text}</span>
                  </div>
                )}
              </div>

              {/* Accounts */}
              <div className="panel accounts-panel">
                <div className="panel-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Users size={14} /> Connected Accounts
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {accounts.some(a => a.status === 'error' || a.error) && (
                      <button
                        type="button"
                        onClick={() => socket.emit('clear_error_tokens')}
                        style={{
                          padding: '3px 8px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                        title="Tüm geçersiz ve patlak tokenları listeden temizle"
                      >
                        <Trash2 size={12} />
                        Geçersizleri Temizle ({accounts.filter(a => a.status === 'error' || a.error).length})
                      </button>
                    )}
                    <span style={{ background:'rgba(255,255,255,0.08)', padding:'2px 8px', borderRadius:10, fontSize:'0.7rem', fontWeight:700, color:'var(--text-3)' }}>
                      {accounts.length}
                    </span>
                  </div>
                </div>

                <div className="accounts-scroll">
                  {accounts.length === 0 && (
                    <div className="empty-state">
                      <Users size={32} />
                      <p>No accounts connected yet.<br/>Add a Discord token to get started.</p>
                    </div>
                  )}

                  {accounts.map(acc => (
                    <div
                      key={acc.token}
                      className={`account-card${acc.inVoice ? ' in-voice' : ''}${acc.error ? ' has-error' : ''}`}
                    >
                      <div className="acc-left">
                        <div className="avatar-wrap">
                          <img
                            src={acc.user?.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                            alt="Avatar"
                            className="avatar"
                          />
                          <div className={`avatar-status ${acc.status}`} />
                        </div>
                        <div className="acc-info">
                          <div className="acc-name" style={acc.softMute ? { opacity:0.45, textDecoration:'line-through' } : {}}>
                            {acc.user ? `${acc.user.username}#${acc.user.discriminator}` : 'Connecting...'}
                          </div>
                          {acc.status === 'connected' && !acc.error && (
                            <div className="acc-sub playing">
                              <Activity size={11} /> Playing Dragon...
                            </div>
                          )}
                          {acc.error && (
                            <div className="acc-sub error-text">{acc.error}</div>
                          )}
                          {acc.inVoice && !acc.error && (
                            <div className="acc-sub" style={{ color:'#a5b4fc' }}>
                              🎙️ In Voice Channel
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="acc-right">
                        {acc.inVoice && <span className="badge badge-voice">Voice</span>}
                        {acc.platform && (
                          <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                            {acc.platform === 'vr' && '🥽 VR'}
                            {acc.platform === 'mobile_android' && '📱 Android'}
                            {acc.platform === 'mobile_ios' && '📱 iOS'}
                            {acc.platform === 'desktop' && '💻 PC'}
                            {acc.platform === 'web' && '🌐 Web'}
                            {acc.platform === 'ps5' && '🎮 PS5'}
                            {acc.platform === 'xbox' && '🎮 Xbox'}
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(acc.token);
                            setCopiedToken(acc.token);
                            setTimeout(() => setCopiedToken(null), 1500);
                          }}
                          title="Hesap Tokenini Kopyala"
                          style={{
                            color: copiedToken === acc.token ? '#10b981' : 'var(--text-3)',
                            padding: '3px 6px',
                            background: copiedToken === acc.token ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid ' + (copiedToken === acc.token ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.08)'),
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            cursor: 'pointer'
                          }}
                        >
                          {copiedToken === acc.token ? <Check size={11} /> : <Copy size={11} />}
                          <span style={{ fontSize: '0.65rem', fontWeight: 600 }}>{copiedToken === acc.token ? 'Kopyalandı' : 'Token'}</span>
                        </button>
                        <span className={`badge badge-${acc.status}`}>{acc.status}</span>

                        {acc.inVoice ? (
                          <>
                            <button
                              className={acc.cameraActive ? 'btn-icon active-cam' : 'btn-icon'}
                              onClick={() => socket.emit('toggle_camera', { token: acc.token, enabled: !acc.cameraActive, cameraDevice: cameraDevices.find(d => d.deviceId === selectedCameraId)?.label || 'Webcam' })}
                              title={acc.cameraActive ? 'Kamerayı Kapat' : 'Kamerayı Aç (Webcam)'}
                              style={{ color: acc.cameraActive ? '#22c55e' : 'var(--text-3)', background: acc.cameraActive ? 'rgba(34, 197, 94, 0.2)' : undefined }}
                            >
                              {acc.cameraActive ? <Camera size={13} /> : <CameraOff size={13} />}
                            </button>

                            <button
                              className={acc.streamActive ? 'btn-icon active-stream' : 'btn-icon'}
                              onClick={() => socket.emit('toggle_stream', { token: acc.token, enabled: !acc.streamActive, streamName: 'Dragon Live' })}
                              title={acc.streamActive ? 'Yayını Kapat' : 'Yayın Aç (Ekran / Go Live)'}
                              style={{ color: acc.streamActive ? '#a855f7' : 'var(--text-3)', background: acc.streamActive ? 'rgba(168, 85, 247, 0.2)' : undefined }}
                            >
                              <Cast size={13} />
                            </button>

                            <button
                              className={acc.softMute ? 'btn-icon-muted' : 'btn-icon'}
                              onClick={() => socket.emit('toggle_soft_mute', { token: acc.token, state: !acc.softMute })}
                              title="Ghost Mute — Cut mic without showing mute icon in Discord"
                            >
                              {acc.softMute ? <MicOff size={13} /> : <Mic size={13} />}
                            </button>

                            <button
                              className="btn-icon"
                              onClick={() => handleDisconnectSingleVoice(acc.token)}
                              title="Bu Hesabı Sesten Çıkar"
                              style={{ color: '#f43f5e' }}
                            >
                              <PhoneOff size={13} />
                            </button>
                          </>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="text"
                              placeholder="Kanal ID"
                              value={accountChannelInputs[acc.token] || ''}
                              onChange={e => setAccountChannelInputs(prev => ({ ...prev, [acc.token]: e.target.value }))}
                              style={{ width: 110, padding: '3px 6px', fontSize: '0.7rem', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#fff' }}
                              title="Özel Kanal ID (Boş bırakılırsa sağdaki ana kanal ID kullanılır)"
                            />
                            <button
                              className="btn-icon"
                              onClick={() => handleJoinSingleVoice(acc.token)}
                              title="Bu Hesabı Tek Başına Sese Sok"
                              style={{ color: '#10b981' }}
                            >
                              <PhoneCall size={13} />
                            </button>
                          </div>
                        )}

                        <button
                          className="btn-icon-logout"
                          onClick={() => handleRemoveToken(acc.token)}
                          title="Remove account"
                        >
                          <LogOut size={13} />
                        </button>
                      </div>

                      {playbackMode === 'individual' && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                          <input
                            type="file"
                            accept="audio/*,video/*,.mp3,.mp4,.wav,.ogg,.flac,.m4a,.aac,.webm,.mkv"
                            ref={el => accountMediaInputRefs.current[acc.token] = el}
                            onChange={e => handleSelectAccountMedia(acc.token, e)}
                            style={{ display: 'none' }}
                          />
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handlePickAccountMedia(acc.token)}
                              style={{ padding: '4px 8px', fontSize: '0.7rem', flexShrink: 0 }}
                            >
                              <FileAudio size={12} /> Dosya Seç
                            </button>
                            <span style={{ fontSize: '0.7rem', color: accountMedia[acc.token]?.fileName ? '#a5b4fc' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {accountMedia[acc.token]?.fileName || 'Medya dosyası seçilmedi'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: '#f43f5e', fontWeight: 600 }}>dB Boost:</span>
                            <input
                              type="number"
                              min="0"
                              max="100000000"
                              value={accountMedia[acc.token]?.volumeDb ?? 0}
                              onChange={e => {
                                const val = Math.max(0, Math.min(100000000, Number(e.target.value) || 0));
                                handleLiveAccountVolume(acc.token, val);
                              }}
                              style={{ width: 85, padding: '1px 4px', fontSize: '0.7rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, color: '#f43f5e', textAlign: 'right' }}
                            />
                            
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleStartAccountMedia(acc.token)}
                              disabled={!accountMedia[acc.token]?.filePath}
                              style={{ padding: '3px 8px', fontSize: '0.7rem', background: acc.mediaStatus === 'playing' ? '#10b981' : undefined }}
                            >
                              <Play size={11} /> {acc.mediaStatus === 'playing' ? 'Çalıyor' : 'Çal'}
                            </button>
                            <button
                              type="button"
                              className="btn-danger"
                              onClick={() => handleStopAccountMedia(acc.token)}
                              style={{ padding: '3px 6px', fontSize: '0.7rem' }}
                            >
                              <Square size={11} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* HIZLI KONTROLLER GRID'I (2-KOLON OTOMATIK YAYILAN) */}
              <div className="controls-grid" style={{ opacity: globalTrackingTarget ? 0.6 : 1, pointerEvents: globalTrackingTarget ? 'none' : 'auto' }}>

                {/* Follow / Connect */}
                <div className="panel">
                <div className="panel-title"><Settings2 size={14} /> Movement & Voice</div>

                <div className="field">
                  <label>Auto-Follow User ID</label>
                  <div style={{ display:'flex', gap:8 }}>
                    <input type="text" value={targetIdInput} onChange={e => setTargetIdInput(e.target.value)} placeholder="423456789123..." />
                    <button className="btn" style={{ flexShrink:0, padding:'9px 14px' }} onClick={handleFollowUser}>
                      <Target size={14} />
                    </button>
                  </div>
                </div>

                <div className="divider">or direct connect</div>

                <div className="field">
                  <label>Voice Channel ID / Group DM ID</label>
                  <input type="text" value={channelId} onChange={e => setChannelId(e.target.value)} placeholder="Sunucu Ses Kanalı veya Grup DM ID..." />
                </div>

                <button className="btn btn-block" onClick={handleJoinVoiceAll} style={{ marginTop:4 }}>
                  <Play size={15} /> Join Channel
                </button>

                <button className="btn-danger-full btn-block" onClick={handleDisconnectVoiceAll} style={{ marginTop:8 }}>
                  <Square size={15} /> Disconnect Voice
                </button>
              </div>

              {/* Microphone */}
              <div className="panel">
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mic size={14} /> Mikrofon & Ses Ayarları
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: micStatus === 'Aktif' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: micStatus === 'Aktif' ? '#22c55e' : '#f87171',
                      border: `1px solid ${micStatus === 'Aktif' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                    }}>
                      ● {micStatus}
                    </span>
                    <button
                      type="button"
                      onClick={refreshDevices}
                      title="Aygıtları Yenile"
                      style={{
                        padding: '3px 6px',
                        fontSize: '0.68rem',
                        borderRadius: 4,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.05)',
                        color: 'var(--text-3)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3
                      }}
                    >
                      <RefreshCw size={11} /> Yenile
                    </button>
                    <div
                      className={`toggle-pill${stereo ? ' active' : ''}`}
                      onClick={() => setStereo(p => !p)}
                      style={{ padding: '2px 8px', fontSize: '0.68rem', height: 'auto', cursor: 'pointer' }}
                      title="Stereo 2-Kanal Ses Aktarımı"
                    >
                      {stereo ? 'Stereo' : 'Mono'}
                    </div>
                  </div>
                </div>

                <div className="field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ margin: 0 }}>Giriş Aygıtı (Mikrofon)</label>
                    <button
                      type="button"
                      onClick={startRecording}
                      style={{
                        padding: '2px 6px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        borderRadius: 4,
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        background: 'rgba(99, 102, 241, 0.15)',
                        color: '#a5b4fc',
                        cursor: 'pointer'
                      }}
                    >
                      Mikrofonu Yeniden Başlat
                    </button>
                  </div>
                  <select value={selectedDeviceId} onChange={e => setSelectedDeviceId(e.target.value)}>
                    {devices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Mikrofon (${d.deviceId.slice(0,6)}...)`}
                      </option>
                    ))}
                  </select>
                  <div className="mic-bar-wrap" style={{ marginTop: 6 }}>
                    <div className="mic-bar-fill" style={{ width:`${micLevel}%` }} />
                  </div>
                  {micError && (
                    <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: 4 }}>
                      ⚠️ {micError}
                    </div>
                  )}
                </div>

                {/* ── SES İYİLEŞTİRME & GÜÇLENDİRME KONTROLLERİ ── */}
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Zap size={13} color="#ef4444" /> Ses Güçlendirme & Netleştirme
                  </div>

                  {/* 1. Ses Güçlendirici */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: voiceBooster ? '#ef4444' : 'var(--text-2)' }}>
                        Ses Güçlendirici (Booster)
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-3)' }}>
                        Mikrofon sinyalini ekstra temiz çarpanla yükseltir ({voiceBoosterGain.toFixed(1)}x)
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceBooster(p => !p)}
                      style={{
                        padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer', border: 'none',
                        background: voiceBooster ? '#ef4444' : 'rgba(255,255,255,0.1)', color: '#fff'
                      }}
                    >
                      {voiceBooster ? 'AÇIK' : 'KAPALI'}
                    </button>
                  </div>
                  {voiceBooster && (
                    <div style={{ padding: '4px 0' }}>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={voiceBoosterGain}
                        onChange={e => setVoiceBoosterGain(Number(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#ef4444' }}
                      />
                    </div>
                  )}

                  {/* 2. Ses Netleştirici */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: voiceClarity ? '#38bdf8' : 'var(--text-2)' }}>
                        Ses Netleştirici (Vokal Parlatıcı)
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-3)' }}>
                        Dip gürültüleri keser, sesin konuşma frekansını öne çıkarır
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceClarity(p => !p)}
                      style={{
                        padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer', border: 'none',
                        background: voiceClarity ? '#38bdf8' : 'rgba(255,255,255,0.1)', color: voiceClarity ? '#000' : '#fff'
                      }}
                    >
                      {voiceClarity ? 'AÇIK' : 'KAPALI'}
                    </button>
                  </div>

                  {/* 3. Ses Dengeleyici */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: voiceCompressor ? '#10b981' : 'var(--text-2)' }}>
                        Ses Dengeleyici (Normalizer)
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-3)' }}>
                        Ses seviyesini dengeler, aşırı patlamaları ve boğulmaları engeller
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceCompressor(p => !p)}
                      style={{
                        padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer', border: 'none',
                        background: voiceCompressor ? '#10b981' : 'rgba(255,255,255,0.1)', color: voiceCompressor ? '#000' : '#fff'
                      }}
                    >
                      {voiceCompressor ? 'AÇIK' : 'KAPALI'}
                    </button>
                  </div>

                  {/* 4. Dip Gürültü Filtresi */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: voiceNoiseGate ? '#a78bfa' : 'var(--text-2)' }}>
                        Dip Gürültü Filtresi (Noise Gate)
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-3)' }}>
                        Konuşmadığınızda arka plan fan/klavye sesini keser
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceNoiseGate(p => !p)}
                      style={{
                        padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 4, cursor: 'pointer', border: 'none',
                        background: voiceNoiseGate ? '#a78bfa' : 'rgba(255,255,255,0.1)', color: voiceNoiseGate ? '#000' : '#fff'
                      }}
                    >
                      {voiceNoiseGate ? 'AÇIK' : 'KAPALI'}
                    </button>
                  </div>
                </div>

                <div className="gain-label" style={{ marginTop: '0.8rem' }}>
                  <span>Genel Kazanç (Gain)</span>
                  <span>{Number(gain).toFixed(1)}x</span>
                </div>
                <input type="range" min="0.1" max="100" step="0.5" value={gain} onChange={e => setGain(Number(e.target.value))} />

                <div className="gain-label" style={{ marginTop: '0.8rem' }}>
                  <span>Bas (Bass)</span>
                  <span style={{ color: bass > 0 ? '#818cf8' : 'var(--text-3)' }}>{bass > 0 ? `+${bass}` : bass} dB</span>
                </div>
                <input type="range" min="-50" max="300" step="1" value={bass} onChange={e => setBass(Number(e.target.value))} />

                <div className="gain-label" style={{ marginTop: '0.8rem' }}>
                  <span>Tiz (Treble)</span>
                  <span style={{ color: treble > 0 ? '#f472b6' : 'var(--text-3)' }}>{treble > 0 ? `+${treble}` : treble} dB</span>
                </div>
                <input type="range" min="-12" max="18" step="1" value={treble} onChange={e => setTreble(Number(e.target.value))} />

                {/* Microphone Pitch Shifter (Ses Tonu Değiştirici) */}
                <div style={{ marginTop: '0.8rem', background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="gain-label">
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>Mikrofon Pitch Shifter:</span>
                    <span style={{ color: micPitch === 0 ? 'var(--text-3)' : micPitch > 0 ? '#38bdf8' : '#f43f5e', fontWeight: 700 }}>
                      {micPitch === 0 ? 'Normal (0)' : micPitch > 0 ? `+${micPitch} (Nightcore / İnce)` : `${micPitch} (Deep / Kalın)`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={micPitch}
                    onChange={e => setMicPitch(Number(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer', accentColor: '#38bdf8' }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Kalın (-6)', val: -6 },
                      { label: 'Derin (-3)', val: -3 },
                      { label: 'Normal (0)', val: 0 },
                      { label: 'İnce (+3)', val: 3 },
                      { label: 'Nightcore (+6)', val: 6 }
                    ].map(p => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setMicPitch(p.val)}
                        style={{
                          padding: '2px 6px',
                          fontSize: '0.65rem',
                          borderRadius: 4,
                          border: 'none',
                          cursor: 'pointer',
                          background: micPitch === p.val ? '#38bdf8' : 'rgba(255,255,255,0.06)',
                          color: micPitch === p.val ? '#000' : 'var(--text-3)',
                          fontWeight: micPitch === p.val ? 700 : 500
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stereo Width Control */}
                {stereo && (
                  <div style={{ marginTop: '0.8rem', background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="gain-label">
                      <span style={{ color: '#a78bfa', fontWeight: 600 }}>Stereo Genişliği (3D Width):</span>
                      <span style={{ color: '#a78bfa', fontWeight: 700 }}>{panWidth.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.1"
                      value={panWidth}
                      onChange={e => setPanWidth(Number(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa' }}
                    />
                  </div>
                )}

                <div className="gain-label" style={{ marginTop: '0.8rem' }}>
                  <span>Sample Rate</span>
                  <span>{hz} Hz</span>
                </div>
                <select value={hz} onChange={e => setHz(Number(e.target.value))} style={{ width:'100%', padding:'0.5rem', background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,255,255,0.1)', color:'#fff', borderRadius:'8px' }}>
                  <option value={8000}>8000 Hz</option>
                  <option value={16000}>16000 Hz</option>
                  <option value={24000}>24000 Hz</option>
                  <option value={44100}>44100 Hz</option>
                  <option value={48000}>48000 Hz (Discord Max)</option>
                </select>
              </div>

              {/* Discord States */}
              <div className="panel">
                <div className="panel-title"><Headphones size={14} /> Discord States</div>

                <div className="field" style={{ marginBottom: '1rem' }}>
                  <label>Status</label>
                  <select 
                    value={status} 
                    onChange={e => setStatus(e.target.value)}
                    style={{ width:'100%', padding:'0.5rem', background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,255,255,0.1)', color:'#fff', borderRadius:'8px' }}
                  >
                    <option value="online">Online</option>
                    <option value="idle">Idle (Boşta)</option>
                    <option value="dnd">Do Not Disturb (Rahatsız Etme)</option>
                    <option value="invisible">Invisible (Çevrimdışı)</option>
                  </select>
                </div>

                <div className="toggles-row">
                  <div className={`toggle-pill${selfMute ? ' active' : ''}`} onClick={() => setSelfMute(p => !p)}>
                    {selfMute ? <MicOff size={14} /> : <Mic size={14} />}
                    {selfMute ? 'Muted' : 'Unmuted'}
                  </div>
                  <div className={`toggle-pill${selfDeaf ? ' active' : ''}`} onClick={() => setSelfDeaf(p => !p)}>
                    <Headphones size={14} />
                    {selfDeaf ? 'Deafened' : 'Undeafened'}
                  </div>
                </div>

                <div className="toggles-row">
                  <div className={`toggle-pill${stereo ? ' active' : ''}`} onClick={() => setStereo(p => !p)}>
                    {stereo ? 'Stereo' : 'Mono'}
                  </div>
                </div>
              </div>

              {/* Platform & Device Selection Panel */}
              <div className="panel">
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Glasses size={14} /> Giriş Platformu (Cihaz Görünümü)
                  </span>
                  <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>
                    {platform === 'vr' && '🥽 Meta Quest (VR)'}
                    {platform === 'mobile_android' && '📱 Android'}
                    {platform === 'mobile_ios' && '📱 iOS (iPhone)'}
                    {platform === 'desktop' && '💻 PC (Windows)'}
                    {platform === 'web' && '🌐 Web'}
                    {platform === 'ps5' && '🎮 PS5'}
                    {platform === 'xbox' && '🎮 Xbox'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.7rem' }}>Cihaz / Platform Seçimi</label>
                    <select
                      value={platform}
                      onChange={e => handlePlatformChange(e.target.value, false)}
                      style={{ width: '100%', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '6px', fontSize: '0.75rem' }}
                    >
                      <option value="vr">🥽 VR Headset (Meta Quest 2 / VRChat)</option>
                      <option value="mobile_android">📱 Mobil Android (Yeşil Telefon İkonu)</option>
                      <option value="mobile_ios">📱 Mobil iOS (Apple iPhone İkonu)</option>
                      <option value="desktop">💻 Masaüstü PC (Windows Desktop)</option>
                      <option value="web">🌐 Web Tarayıcı (Discord Web / Chrome)</option>
                      <option value="ps5">🎮 PlayStation 5 (PS5)</option>
                      <option value="xbox">🎮 Xbox Series X</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[
                      { id: 'vr', label: '🥽 VR (Quest)' },
                      { id: 'mobile_android', label: '📱 Android' },
                      { id: 'mobile_ios', label: '📱 iOS' },
                      { id: 'desktop', label: '💻 PC' },
                      { id: 'web', label: '🌐 Web' },
                      { id: 'ps5', label: '🎮 PS5' },
                      { id: 'xbox', label: '🎮 Xbox' }
                    ].map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handlePlatformChange(p.id, false)}
                        style={{
                          padding: '3px 7px',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          borderRadius: 4,
                          cursor: 'pointer',
                          border: '1px solid ' + (platform === p.id ? '#6366f1' : 'rgba(255,255,255,0.1)'),
                          background: platform === p.id ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.04)',
                          color: platform === p.id ? '#a5b4fc' : 'var(--text-3)'
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <span style={{ fontSize: '0.66rem', color: 'var(--text-3)' }}>
                    💡 Hesapların Discord'da hangi cihazdan giriş yapmış gibi görüneceğini belirler.
                  </span>

                  <button
                    type="button"
                    className="btn btn-block"
                    onClick={() => handlePlatformChange(platform, true)}
                    disabled={platformApplying || accounts.length === 0}
                    style={{ marginTop: 2, padding: '7px', fontSize: '0.75rem', background: platformApplying ? '#10b981' : undefined }}
                  >
                    <RefreshCw size={13} className={platformApplying ? 'spin' : ''} />
                    {platformApplying ? 'Hesaplar Yeniden Bağlanıyor...' : 'Platformu Uygula & Hesapları Yeniden Bağla'}
                  </button>
                </div>
              </div>

              {/* Rich Presence (Activity / Playing) Panel */}
              <div className="panel">
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Gamepad2 size={14} /> Discord Aktivite (Oynuyor)
                  </span>
                  <div
                    className={`toggle-pill${rpcEnabled ? ' active' : ''}`}
                    onClick={() => {
                      const next = !rpcEnabled;
                      setRpcEnabled(next);
                      socket.emit('update_rpc', {
                        enabled: next,
                        name: rpcName,
                        details: rpcDetails,
                        state: rpcState,
                        type: rpcType
                      });
                    }}
                    style={{ padding: '2px 8px', fontSize: '0.7rem', height: 'auto', cursor: 'pointer' }}
                  >
                    {rpcEnabled ? 'Açık' : 'Kapalı'}
                  </div>
                </div>

                {rpcEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.7rem' }}>Aktivite Türü</label>
                      <select
                        value={rpcType}
                        onChange={e => setRpcType(e.target.value)}
                        style={{ width: '100%', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '6px', fontSize: '0.75rem' }}
                      >
                        <option value="PLAYING">Oynuyor (Playing)</option>
                        <option value="LISTENING">Dinliyor (Listening)</option>
                        <option value="WATCHING">İzliyor (Watching)</option>
                        <option value="COMPETING">Yarışıyor (Competing)</option>
                        <option value="STREAMING">Yayında (Streaming)</option>
                      </select>
                    </div>

                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.7rem' }}>Oyun / Aktivite Adı</label>
                      <input
                        type="text"
                        value={rpcName}
                        onChange={e => setRpcName(e.target.value)}
                        placeholder="Grand Theft Auto V, Valorant, Spotify..."
                        style={{ fontSize: '0.75rem', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.7rem' }}>Açıklama (Details - İsteğe Bağlı)</label>
                      <input
                        type="text"
                        value={rpcDetails}
                        onChange={e => setRpcDetails(e.target.value)}
                        placeholder="Boş bırakılırsa hesap sayısı yazar"
                        style={{ fontSize: '0.75rem', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.7rem' }}>Durum (State - İsteğe Bağlı)</label>
                      <input
                        type="text"
                        value={rpcState}
                        onChange={e => setRpcState(e.target.value)}
                        placeholder="Boş bırakılırsa seste/boşta yazar"
                        style={{ fontSize: '0.75rem', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.7rem' }}>Aktivite Görseli (Büyük Resim URL / Discord CDN - İsteğe Bağlı)</label>
                      <input
                        type="text"
                        value={rpcImage}
                        onChange={e => setRpcImage(e.target.value)}
                        placeholder="Boş bırakılırsa otomatik Dragon logosu yüklenir"
                        style={{ fontSize: '0.75rem', padding: '6px 8px' }}
                      />
                    </div>

                    <button
                      type="button"
                      className="btn btn-block"
                      onClick={handleApplyRPC}
                      style={{ marginTop: 4, padding: '7px', fontSize: '0.75rem', background: rpcSavedNotice ? '#10b981' : undefined }}
                    >
                      {rpcSavedNotice ? <Check size={13} /> : <Sparkles size={13} />}
                      {rpcSavedNotice ? 'Aktivite Uygulandı!' : 'Aktiviteyi Uygula'}
                    </button>
                  </div>
                )}
              </div>

              {/* End of controls-grid */}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
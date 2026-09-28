const { exec } = require('child_process');
const path = require('path');

const ROUTER_EXE = path.join(__dirname, 'tools', 'AudioRouter.exe');

let pollInterval = null;
let lastTrack = null;
let onTrackChange = null;
let connected = false;

function runRouter(args) {
  return new Promise(resolve => {
    exec(`"${ROUTER_EXE}" ${args}`, (err, stdout) => {
      resolve((stdout || '').trim());
    });
  });
}

function isSpotifyRunning() {
  return new Promise(resolve => {
    exec('powershell -command "Get-Process spotify -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id"', (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

function getSpotifyTrack() {
  return new Promise(resolve => {
    exec('powershell -command "Get-Process spotify -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object -First 1 -ExpandProperty MainWindowTitle"', (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      const title = stdout.trim();
      if (title === 'Spotify' || !title.includes(' - ')) return resolve({ playing: false });
      const clean = title.replace(/^Spotify\s*[-]\s*/i, '');
      const idx = clean.indexOf(' - ');
      if (idx === -1) return resolve({ playing: false });
      const artist = clean.substring(0, idx).trim();
      const song = clean.substring(idx + 3).trim();
      resolve({ playing: true, artist, song, full: `${artist} - ${song}` });
    });
  });
}

async function connect() {
  const running = await isSpotifyRunning();
  if (!running) {
    return { success: false, message: "Bulunamadı, lütfen Spotify'ı açın." };
  }

  const result = await runRouter('set "CABLE Input"');
  if (result.startsWith('ERROR')) {
    return { success: false, message: 'VB-Audio Cable bulunamadı.' };
  }
  if (result.startsWith('NOTFOUND')) {
    return { success: false, message: "Spotify'ı açıp bir şarkı çalın, sonra tekrar deneyin." };
  }

  // Registry degisti, Spotify'i yeniden baslatarak aktif et
  await restartSpotify();

  connected = true;
  startPolling();
  return { success: true, message: 'Bağlanıldı, müzik açabilirsiniz.' };
}

function restartSpotify() {
  return new Promise(resolve => {
    exec('powershell -command "$path = (Get-Process spotify -ErrorAction SilentlyContinue | Select-Object -First 1).Path; Stop-Process -Name spotify -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1500; if($path) { Start-Process $path }"', () => {
      setTimeout(resolve, 2000);
    });
  });
}

async function disconnect() {
  connected = false;
  lastTrack = null;
  stopPolling();
  // Varsayılan cihaza geri döndür
  await runRouter('reset');
}

function startPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    if (!connected) return;
    const track = await getSpotifyTrack();
    if (track === null) {
      connected = false;
      lastTrack = null;
      if (onTrackChange) onTrackChange(null);
      stopPolling();
      return;
    }
    const key = track.playing ? track.full : null;
    if (key !== lastTrack) {
      lastTrack = key;
      if (onTrackChange) onTrackChange(track.playing ? track : null);
    }
  }, 2000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function setTrackChangeHandler(fn) { onTrackChange = fn; }
function isConnected() { return connected; }

module.exports = { connect, disconnect, setTrackChangeHandler, isConnected };

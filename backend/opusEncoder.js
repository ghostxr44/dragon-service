const koffi = require('koffi');
const path = require('path');

const dllPath = path.join(__dirname, '..', 'opus.dll');

let lib, opusEncoderCreate, opusEncode, opusEncoderDestroy;

try {
  lib = koffi.load(dllPath);

  opusEncoderCreate = lib.func('opus_encoder_create', 'void *', ['int', 'int', 'int', 'int *']);
  opusEncode        = lib.func('opus_encode',         'int',    ['void *', 'int16_t *', 'int', 'uint8_t *', 'int32_t']);
  opusEncoderDestroy= lib.func('opus_encoder_destroy','void',   ['void *']);

  console.log('[OpusEncoder] Native opus.dll loaded successfully.');
} catch (e) {
  console.error('[OpusEncoder] Failed to load opus.dll, falling back to opusscript:', e.message);
}

const SAMPLE_RATE   = 48000;
const CHANNELS      = 2;
const FRAME_SIZE    = 960; // 20ms @ 48kHz
const OPUS_APPLICATION_AUDIO = 2049;

class NativeOpusEncoder {
  constructor() {
    this._encoder = null;
    this._outputBuf = Buffer.alloc(4000);
    this._init();
  }

  _init() {
    if (!opusEncoderCreate) return;
    const errBuf = Buffer.alloc(4);
    this._encoder = opusEncoderCreate(SAMPLE_RATE, CHANNELS, OPUS_APPLICATION_AUDIO, errBuf);
    const err = errBuf.readInt32LE(0);
    if (err < 0) {
      console.error('[OpusEncoder] opus_encoder_create error:', err);
      this._encoder = null;
    }
  }

  // input: Int16Array stereo interleaved, returns Buffer of encoded opus packet
  encode(int16Array) {
    if (!this._encoder) return null;
    const inputBuf = Buffer.from(int16Array.buffer);
    const written = opusEncode(this._encoder, inputBuf, FRAME_SIZE, this._outputBuf, this._outputBuf.length);
    if (written < 0) return null;
    return this._outputBuf.slice(0, written);
  }

  destroy() {
    if (this._encoder && opusEncoderDestroy) {
      opusEncoderDestroy(this._encoder);
      this._encoder = null;
    }
  }
}

module.exports = { NativeOpusEncoder, FRAME_SIZE, CHANNELS, isNativeAvailable: !!opusEncoderCreate };

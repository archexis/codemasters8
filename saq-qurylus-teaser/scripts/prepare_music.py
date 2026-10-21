"""Edit a licensed track to the existing 15-second visual and sound timeline."""
from pathlib import Path
import json
import subprocess
import wave
import numpy as np
import imageio_ffmpeg

root = Path(__file__).resolve().parent.parent
sr = 48000
frames = 450
source_in = 6.5  # Source pulse at ~9 seconds lands on the 2.5-second target shot.
data = subprocess.run([
    imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(source_in),
    '-i', str(root/'public/audio/cinematic-tension-002.mp3'), '-t', '15',
    '-ar', str(sr), '-ac', '2', '-f', 'f32le', '-'
], check=True, capture_output=True).stdout
music = np.frombuffer(data, dtype='<f4').reshape(-1, 2).astype(np.float64)
music = music[:sr*15]
if len(music)<sr*15:
    music = np.pad(music, ((0,sr*15-len(music)),(0,0)))
t = np.arange(sr*15)/sr
# Retain the existing 0.2-second breathing room and clean, unmasked brand impact.
envelope = np.interp(t, [0,.3,2.5,6,10.4,12.35,12.5,15], [0,.58,.68,.82,1,1,0,0])
music *= .105/max(np.sqrt(np.mean(music[:12*sr]**2)),1e-8)
music *= envelope[:,None]

def read_stem(name):
    with wave.open(str(root/f'public/audio/{name}.wav'),'rb') as f:
        return np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').reshape(-1,2)/32768

mix = music + read_stem('atmosphere')*.15 + read_stem('mechanics')*.75 + read_stem('impacts')
mix_gain = min(1.0, .87/np.max(np.abs(mix)))
with wave.open(str(root/'public/audio/music-edit.wav'),'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(sr)
    f.writeframes((np.clip(music,-1,1)*32767).astype('<i2').tobytes())
config = {
    'title':'Cinematic Tension 002','artist':'Sascha Ende',
    'sourcePage':'https://ende.app/en/song/12249-cinematic-tension-002',
    'license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/',
    'sourceInSeconds':source_in,'musicEndsAtSeconds':12.5,
    'sourceQuality':'128 kbps MP3 publicly supplied by the composer',
    'gains':{'music':mix_gain,'atmosphere':.15*mix_gain,'mechanics':.75*mix_gain,'impacts':mix_gain},
    'mixedPeakDbFS':float(20*np.log10(np.max(np.abs(mix*mix_gain)))),
    'edits':'Excerpt, level automation, fade in, cut at 12.5 seconds, mixed with original sound effects.',
}
(root/'src/config/music.json').write_text(json.dumps(config,indent=2)+'\n')
(root/'out/music-edit.json').write_text(json.dumps(config,indent=2)+'\n')
print(json.dumps(config,indent=2))

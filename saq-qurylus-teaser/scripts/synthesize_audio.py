"""Original deterministic sound design; no third-party recordings or live WebAudio.
Run from project root: python scripts/synthesize_audio.py
"""
from pathlib import Path
import json
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / 'src/config/audio-events.json').read_text())
SR = 48000
DURATION = CONFIG['durationInFrames'] / CONFIG['fps']
N = int(SR * DURATION)
RNG = np.random.default_rng(20261020)
t = np.arange(N) / SR
stems = {name: np.zeros((N, 2), dtype=np.float64) for name in ['atmosphere', 'mechanics', 'impacts']}

def add(stem, data, at, gain=1.0, pan=0.0):
    offset = round(at * SR)
    length = min(len(data), N - offset)
    if length <= 0:
        return
    if data.ndim == 1:
        data = np.column_stack([data * (1 - pan * .25), data * (1 + pan * .25)])
    stems[stem][offset:offset + length] += data[:length] * gain

def envelope(time, attack=.004, decay=5.0):
    return (1 - np.exp(-time / attack)) * np.exp(-time * decay)

def transient(kind):
    length = {'click': .19, 'impact': 1.15, 'distant': 1.8, 'brand': 2.3, 'reverse': .8}[kind]
    x = np.arange(round(length * SR)) / SR
    noise = RNG.normal(0, 1, len(x))
    if kind == 'click':
        # Short relay-like contact and a dry metallic resonance.
        signal = (.15 * noise + .23 * np.sin(2*np.pi*1780*x) + .16*np.sin(2*np.pi*2670*x)) * envelope(x, .001, 67)
    elif kind == 'reverse':
        amp = np.sin(np.pi * np.clip(x / length, 0, 1)) ** 1.4
        smooth = np.convolve(noise, np.ones(25)/25, mode='same')
        signal = (.36*smooth + .12*np.sin(2*np.pi*(160*x+100*x*x))) * amp
    else:
        phase = 2*np.pi*(34*x + (22 if kind == 'brand' else 40) * (1-np.exp(-x*12))/12)
        sub = np.sin(phase) * envelope(x, .005, 2.7 if kind == 'brand' else 4)
        body = .24 * np.sin(2*np.pi*79*x) * envelope(x, .003, 10)
        contact = .11 * noise * envelope(x, .001, 85)
        signal = sub + body + contact
        if kind == 'distant':
            signal *= .6
    # No discontinuities at file edges. Preserve low-end in mono; widen the tail.
    signal *= np.minimum(1, (length - x) / .018)
    delay = int(.009 * SR)
    side = np.roll(signal, delay) * .11
    side[:delay] = 0
    return np.column_stack([signal + side, signal - side])

# The room evolves through the first 12 seconds, then stops at frame 375.
fade_in = np.clip(t / .65, 0, 1)
fade_out = np.clip((12.5 - t) / .055, 0, 1)
tension = np.clip(t / 12, 0, 1)
low_noise = np.convolve(RNG.normal(0, 1, N), np.ones(127)/127, mode='same')
room = (.032*np.sin(2*np.pi*31*t) + .025*np.sin(2*np.pi*43.2*t) + .042*low_noise)
tone = (.006 + .017*tension**2) * (np.sin(2*np.pi*146.8*t) + .35*np.sin(2*np.pi*151.1*t))
ambience = (room + tone) * fade_in * fade_out
add('atmosphere', ambience, 0)

# Increasingly close, low electronic pulses; no musical stock bed.
for i, frame in enumerate([42, 104, 153, 174, 204, 228, 258, 282, 300, 327, 342]):
    x = np.arange(int(.33*SR))/SR
    p = .085*np.sin(2*np.pi*(64*x-19*x*x))*envelope(x, .003, 16)
    add('mechanics', p, frame/30, pan=(-1 if i%2 else 1)*.5)

for event in CONFIG['events']:
    add('mechanics' if event['kind']=='click' else 'impacts', transient(event['kind']), event['frame']/CONFIG['fps'], event['gain'])

mix = sum(stems.values())
gain = .87 / np.max(np.abs(mix))
audio_dir = ROOT / 'public/audio'
audio_dir.mkdir(exist_ok=True)
for name, data in stems.items():
    pcm = (np.clip(data*gain, -1, 1)*32767).astype('<i2')
    with wave.open(str(audio_dir / f'{name}.wav'), 'wb') as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(SR)
        file.writeframes(pcm.tobytes())
mix *= gain
report = {'seed':20261020, 'sampleRate':SR, 'channels':2, 'samples':N, 'duration':DURATION,
          'peakDbFS':float(20*np.log10(np.max(np.abs(mix)))),
          'rmsDbFS':float(20*np.log10(np.sqrt(np.mean(mix**2)))),
          'brandBreathingRoomSamples':int(np.count_nonzero(np.max(np.abs(mix[600000:609600]),axis=1)<1e-5)),
          'events':CONFIG['events']}
(ROOT / 'out/audio-synthesis.json').write_text(json.dumps(report, indent=2))
print(json.dumps({key:value for key,value in report.items() if key!='events'}, indent=2))

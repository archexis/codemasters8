"""Original calm, gently positive instrumental. No third-party samples."""
from pathlib import Path
import numpy as np
import wave,subprocess
import imageio_ffmpeg

R=Path(__file__).resolve().parent.parent
SR=48000;DURATION=60;BEAT=.75;BAR=4*BEAT
rng=np.random.default_rng(813)
mix=np.zeros((SR*DURATION,2),dtype=np.float64)

def hz(midi):return 440*2**((midi-69)/12)
def add(sound,start,gain=1,pan=0):
    at=round(start*SR)
    if at>=len(mix):return
    n=min(len(sound),len(mix)-at)
    if n<=0:return
    mix[at:at+n,0]+=sound[:n]*gain*np.sqrt((1-pan)/2)
    mix[at:at+n,1]+=sound[:n]*gain*np.sqrt((1+pan)/2)

def piano(note,length=3.0):
    t=np.arange(round(length*SR))/SR;f=hz(note)
    body=np.zeros_like(t)
    for harmonic,amp,decay in [(1,1,1.25),(2,.25,2.4),(3,.08,3.6),(4,.035,5.5)]:
        body+=amp*np.sin(2*np.pi*f*harmonic*t)*np.exp(-t*decay)
    body+=.12*np.sin(2*np.pi*f*1.0018*t)*np.exp(-t*1.7)
    return body*(1-np.exp(-t/0.008))*np.minimum(1,(length-t)/.14)

def pad(note,length=3.7):
    t=np.arange(round(length*SR))/SR;f=hz(note)
    env=np.minimum(1,t/.65)*np.minimum(1,(length-t)/.85)
    return (np.sin(2*np.pi*f*t)+.15*np.sin(2*np.pi*f*2*t)+.12*np.sin(2*np.pi*f*1.001*t))*env

# Dmaj9 -> Aadd9 -> Bm7 -> Gmaj7: optimistic, restrained, no dramatic cadence.
chords=[[50,57,61,64,66],[45,52,57,59,64],[47,54,57,62,66],[43,50,54,59,62]]
melody=[[78,76,73,76],[76,73,71,73],[74,73,69,73],[71,69,66,69]]
for bar in range(20):
    start=bar*BAR;chord=chords[bar%4]
    energy=.72 if bar<2 else .93 if bar<16 else .70
    for i,note in enumerate(chord[1:]):
        add(pad(note+12),start,.012*energy,(i-1.5)*.25)
    # A soft keyboard arpeggio, with room for the interface actions.
    for k,index in enumerate([1,3,2,4,1,3,2,4]):
        note=chord[index]+12
        add(piano(note,2.8),start+k*BEAT/2,.038*energy,(-.30 if k%2==0 else .30))
    if 2<=bar<18:
        # Rounded bass, no sub-heavy cinematic texture.
        for beat in [0,2]:add(piano(chord[0]-12,1.6),start+beat*BEAT,.042,-.03)
        # Light, band-limited brush texture rather than an assertive drum groove.
        for k in range(8):
            t=np.arange(round(.075*SR))/SR
            noise=rng.normal(size=len(t));noise=np.convolve(noise,np.ones(4)/4,mode='same')
            brush=noise*np.exp(-t*75)*(1-np.exp(-t/.002))
            add(brush,start+k*BEAT/2,.009 if k%2 else .005,.35 if k%2 else -.35)
    if 3<=bar<18 and bar%2:
        for i,note in enumerate(melody[bar%4]):
            add(piano(note,3.3),start+(i*.75+.25)*BEAT,.023,-.12)

# Natural tail and a soft major ending under the brand card.
for i,note in enumerate([50,57,61,66,73]):add(piano(note,5.8),54+i*.045,.030,(i-2)*.12)
dry=mix.copy()
for delay,gain in [(.109,.10),(.223,.07),(.349,.045),(.461,.03)]:
    offset=round(delay*SR)
    mix[offset:]+=dry[:-offset,::-1]*gain
t=np.arange(len(mix))/SR
mix*=np.minimum(1,t/1.5)[:,None]*np.minimum(1,(DURATION-t)/2.6)[:,None]
mix*=.72/max(.01,np.max(np.abs(mix)))
raw=R/'public/positive-music-raw.wav'
with wave.open(str(raw),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR)
    f.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
dest=R/'public/atmosphere.wav'
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',str(raw),'-af','loudnorm=I=-20:TP=-2:LRA=7','-ar',str(SR),'-ac','2','-c:a','pcm_s16le',str(dest)],check=True)
print('Created original neutral-positive music: D major, 80 BPM, 60 seconds.')

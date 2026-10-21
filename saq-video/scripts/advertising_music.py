"""Create a licensed advertising edit of Motivator by Kevin MacLeod (CC BY 4.0)."""
from pathlib import Path
import subprocess,json
import imageio_ffmpeg
R=Path(__file__).resolve().parent.parent
track=R/'public/music/kevin-macleod-motivator.mp3'
probe=R/'node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe'
meta=json.loads(subprocess.check_output([str(probe),'-v','error','-show_format','-of','json',str(track)]))
duration=float(meta['format']['duration'])
# Use the actual musical ending under the logo, joined with an equal-power crossfade.
filters=f'[0:a]atrim=end=56,asetpts=PTS-STARTPTS[body];[0:a]atrim=start={duration-6}:end={duration},asetpts=PTS-STARTPTS,apad=whole_dur=6,atrim=end=6[end];[body][end]acrossfade=d=2:c1=qsin:c2=qsin,afade=t=in:d=0.25,afade=t=out:st=59.3:d=0.7,loudnorm=I=-17:TP=-1.5:LRA=8,apad=whole_dur=60,atrim=end=60[out]'
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',str(track),'-filter_complex',filters,'-map','[out]','-ar','48000','-ac','2','-c:a','pcm_s16le','-metadata','title=Motivator - 60-second SAQ QURYLYS edit','-metadata','artist=Kevin MacLeod','-metadata','comment=CC BY 4.0; https://incompetech.com; trimmed, crossfaded, loudness normalized',str(R/'public/atmosphere.wav')],check=True)
print('Prepared advertising soundtrack: Motivator, 126 BPM, real drums/bass/synths, 60-second edit.')

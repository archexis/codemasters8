"""Prepare a 60-second edit of the user-supplied Tycho recording."""
from pathlib import Path
import subprocess,json
import imageio_ffmpeg
R=Path(__file__).resolve().parent.parent
source=R/'public/music/tycho-awake.mp3'
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',str(source),'-map','0:a:0','-vn','-af','atrim=start=0:end=60,asetpts=PTS-STARTPTS,afade=t=in:d=0.35,afade=t=out:st=57.2:d=2.8,loudnorm=I=-17:TP=-1.5:LRA=8,apad=whole_dur=60,atrim=end=60','-ar','48000','-ac','2','-c:a','pcm_s16le','-metadata','title=Awake - SAQ QURYLYS 60-second edit','-metadata','artist=Tycho','-metadata','comment=User-supplied recording; excerpt 00:00-01:00, fades and loudness normalization.',str(R/'public/atmosphere.wav')],check=True)
print('Prepared Tycho - Awake: first 60 seconds, smooth fades, normalized level.')

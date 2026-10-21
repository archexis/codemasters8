"""Replace only audio; preserve every encoded video packet."""
from pathlib import Path
import subprocess
import imageio_ffmpeg
R=Path(__file__).resolve().parent.parent
movie=R/'out/SAQ_QURYLYS_Cinematic_60s.mp4'
backup=R/'out/SAQ_QURYLYS_Cinematic_60s_before_music.mp4'
if not backup.exists():movie.rename(backup)
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',str(backup),'-i',str(R/'public/atmosphere.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t','60','-metadata','comment=Music: Awake by Tycho. User-supplied recording; excerpt 00:00-01:00, fades and level normalization. Video made with Remotion.','-movflags','+faststart',str(movie)],check=True)
print('Music replaced; original video stream copied without re-encoding.')

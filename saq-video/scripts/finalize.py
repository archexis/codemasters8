"""Normalize Remotion's full-range encoder and AAC padding to the delivery spec."""
from pathlib import Path
import subprocess
import imageio_ffmpeg
r=Path(__file__).resolve().parent.parent
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',str(r/'out/remotion-master.mp4'),'-vf','scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-frames:v','1800','-r','30','-c:v','libx264','-preset','slow','-crf','16','-c:a','aac','-b:a','192k','-af','atrim=end=60,asetpts=PTS-STARTPTS','-t','60','-metadata','comment=Music: Awake by Tycho. User-supplied recording; excerpt 00:00-01:00, fades and level normalization.','-movflags','+faststart',str(r/'out/SAQ_QURYLYS_Cinematic_60s.mp4')],check=True)

"""Normalize honest browser captures and synthesize an original atmospheric score."""
from pathlib import Path
import subprocess,json,sys
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent.parent
FF=imageio_ffmpeg.get_ffmpeg_exe()
manifest=json.loads((ROOT/'out/capture-manifest.json').read_text())
for s in manifest:
    dest=ROOT/'public/footage'/f"{s['name']}.mp4"
    subprocess.run([FF,'-v','error','-y','-ss',str(s['start']),'-i',str(ROOT/s['raw']),'-t',str(s['seconds']),'-vf','fps=30,tpad=stop_mode=clone:stop_duration=1','-frames:v',str(s['seconds']*30),'-an','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p',str(dest)],check=True)
    print('Normalized',s['name'],flush=True)
(ROOT/'src/capture-events.json').write_text(json.dumps({s['name']:s['events'] for s in manifest},indent=2))
subprocess.run([sys.executable,str(ROOT/'scripts/tycho_music.py')],check=True)

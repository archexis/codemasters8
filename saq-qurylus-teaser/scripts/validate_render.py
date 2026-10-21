"""Probe and fully decode the exported MP4; extract review frames from that MP4."""
from pathlib import Path
import json
import subprocess
import hashlib
import numpy as np

root = Path(__file__).resolve().parent.parent
binary_dir = root/'node_modules/@remotion/compositor-win32-x64-msvc'
ffmpeg = str(binary_dir/'ffmpeg.exe') if binary_dir.exists() else 'ffmpeg'
ffprobe = str(binary_dir/'ffprobe.exe') if binary_dir.exists() else 'ffprobe'
try:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    # Full FFmpeg includes the analysis-oriented raw-video/PCM muxers.
    import shutil
    ffmpeg = shutil.which('ffmpeg') or ffmpeg
movie = root/'out/saq-qurylus-teaser.mp4'

def run(args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))
    return result

metadata = json.loads(run([ffprobe,'-v','error','-count_frames','-show_streams','-show_format','-of','json',str(movie)]).stdout)
video = next(s for s in metadata['streams'] if s['codec_type']=='video')
audio = next(s for s in metadata['streams'] if s['codec_type']=='audio')
assert video['codec_name']=='h264'
assert video['pix_fmt']=='yuv420p'
assert (video['width'],video['height'])==(1920,1080)
assert video['r_frame_rate']=='30/1'
assert int(video['nb_read_frames'])==450
assert abs(float(video['duration'])-15)<.00001
assert abs(float(metadata['format']['duration'])-15)<.00001
assert audio['codec_name']=='aac' and audio['channels']==2
assert audio['sample_rate']=='48000'
decode = run([ffmpeg,'-v','error','-i',str(movie),'-c:v','rawvideo','-c:a','pcm_s16le','-f','null','-'])
assert not decode.stderr, decode.stderr.decode(errors='replace')
gray = run([ffmpeg,'-v','error','-i',str(movie),'-an','-vf','scale=64:36,format=gray','-f','rawvideo','-']).stdout
pixels = np.frombuffer(gray,dtype=np.uint8).reshape(450,36,64)
black = [i for i,f in enumerate(pixels) if float(f.mean())<1]
assert all(i<13 for i in black), f'Unexpected absolute-black frames: {black}'
pcm = run([ffmpeg,'-v','error','-i',str(movie),'-vn','-f','f32le','-acodec','pcm_f32le','-']).stdout
wave = np.frombuffer(pcm,dtype='<f4')
assert np.max(np.abs(wave))<1, 'Clipping in encoded output'
assert np.sqrt(np.mean(wave**2))>.01, 'Unexpected silent audio'

frames = [0,30,60,74,75,90,120,134,135,150,179,180,210,225,239,240,260,299,300,320,350,355,359,363,367,371,374,375,381,390,405,449]
expression = '+'.join(f'eq(n\\,{frame})' for frame in frames)
out = root/'out/frames'
out.mkdir(exist_ok=True)
run([ffmpeg,'-v','error','-y','-i',str(movie),'-an','-vf',f'select={expression}','-fps_mode','vfr','-start_number','0',str(out/'review-%03d.png')])
for i,frame in enumerate(frames):
    (out/f'review-{i:03d}.png').replace(out/f'element-{frame:03d}.png')
report = {
    'passed':True, 'duration':float(metadata['format']['duration']),
    'video':{k:video[k] for k in ['codec_name','width','height','pix_fmt','r_frame_rate','nb_read_frames']},
    'audio':{k:audio[k] for k in ['codec_name','channels','sample_rate','duration']},
    'audioPeakDbFS':float(20*np.log10(np.max(np.abs(wave)))),
    'audioRmsDbFS':float(20*np.log10(np.sqrt(np.mean(wave**2)))),
    'fullDecode':'passed without errors', 'absoluteBlackFrames':black,
    'reviewFrames':frames,
    'sha256':hashlib.sha256(movie.read_bytes()).hexdigest(),
}
(root/'out/validation.json').write_text(json.dumps(report,indent=2))
(root/'out/ffprobe.json').write_text(json.dumps(metadata,indent=2))
print(json.dumps(report,indent=2))

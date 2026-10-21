"""QA the actual exported MP4, including all decoded video and audio samples."""
from pathlib import Path
import subprocess,json,hashlib,math,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg
R=Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding='utf-8')
FF=imageio_ffmpeg.get_ffmpeg_exe()
PROBE=str(R/'node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe')
MOV=R/'out/SAQ_QURYLYS_Cinematic_60s.mp4'
def run(args):
    p=subprocess.run(args,capture_output=True)
    if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
    return p
def probe(file):return json.loads(run([PROBE,'-v','error','-count_frames','-show_streams','-show_format','-of','json',str(file)]).stdout)
meta=probe(MOV)
v=next(s for s in meta['streams'] if s['codec_type']=='video')
a=next(s for s in meta['streams'] if s['codec_type']=='audio')
assert v['codec_name']=='h264' and v['pix_fmt']=='yuv420p'
assert (v['width'],v['height'])==(1920,1080)
assert v['r_frame_rate']==v['avg_frame_rate']=='30/1'
assert int(v['nb_read_frames'])==1800
assert float(v['duration'])==60.0 and float(meta['format']['duration'])==60.0
assert a['codec_name']=='aac'
dec=run([FF,'-v','error','-i',str(MOV),'-f','null','-'])
assert not dec.stderr,dec.stderr
raw=run([FF,'-v','error','-i',str(MOV),'-an','-vf','scale=96:54,format=gray','-f','rawvideo','-']).stdout
pix=np.frombuffer(raw,dtype=np.uint8).reshape(1800,54,96)
black=[i for i,f in enumerate(pix) if f.mean()<2]
assert not black,black
pcm=run([FF,'-v','error','-i',str(MOV),'-vn','-f','f32le','-acodec','pcm_f32le','-']).stdout
audio=np.frombuffer(pcm,dtype='<f4')
peak=float(np.max(np.abs(audio)));rms=float(np.sqrt(np.mean(audio**2)))
assert 0.001<rms and peak<1
review=[0,90,180,240,360,480,600,750,810,930,1020,1140,1260,1320,1440,1560,1665,1710,1755,1799]
dest=R/'out/frames';dest.mkdir(exist_ok=True)
expr='+'.join(f'eq(n\\,{f})' for f in review)
run([FF,'-v','error','-y','-i',str(MOV),'-an','-vf',f'select={expr}','-fps_mode','vfr','-start_number','0',str(dest/'review-%03d.png')])
sheet=Image.new('RGB',(1920,5*304),'#101820');draw=ImageDraw.Draw(sheet)
try:font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',21)
except OSError:font=ImageFont.load_default()
for i,frame in enumerate(review):
    f=dest/f'review-{i:03}.png';im=Image.open(f).resize((480,270),Image.Resampling.LANCZOS)
    x=i%4*480;y=i//4*304;sheet.paste(im,(x,y))
    draw.text((x+14,y+274),f'00:{frame//30:02d}:{frame%30:02d}  /  frame {frame}',fill='#9BAAB7',font=font)
sheet.save(R/'out/contact-sheet.png')
inputs=[]
for s in json.loads((R/'out/capture-manifest.json').read_text()):
    original=probe(R/s['raw']);normalized=probe(R/'public/footage'/f"{s['name']}.mp4")
    ov=next(x for x in original['streams'] if x['codec_type']=='video')
    nv=next(x for x in normalized['streams'] if x['codec_type']=='video')
    # Recorder time bases can round the terminal sample down by one frame.
    # Remotion holds the last decoded frame through the exact Sequence boundary.
    held=s['seconds']*30-int(nv['nb_read_frames'])
    assert nv['r_frame_rate']=='30/1' and 0<=held<=1
    inputs.append({'scene':s['name'],'sourceFrameRate':ov['r_frame_rate'],'sourceSize':[ov['width'],ov['height']],'normalizedFrames':nv['nb_read_frames'],'normalizedFrameRate':nv['r_frame_rate'],'terminalFrameHold':held,'sourceTrimSeconds':s['start']})
state=json.loads((R/'out/demo-state-evidence.json').read_text(encoding='utf-8'))
assert len(state['cases'])==1
assert state['cases'][0]['complexId']=='SQ-001' and state['cases'][0]['status']=='draft'
assert len(state.get('assertions',[]))==1
fact=state['assertions'][0]
assert fact['status']=='verified' and fact['code']=='R2'
result={'passed':True,'durationSeconds':60.0,'bytes':MOV.stat().st_size,'sha256':hashlib.sha256(MOV.read_bytes()).hexdigest(),'video':{k:v[k] for k in ['codec_name','width','height','pix_fmt','r_frame_rate','avg_frame_rate','nb_read_frames','duration']},'audio':{k:a[k] for k in ['codec_name','sample_rate','channels','duration']},'fullDecode':'all video and audio decoded without error','blackFrames':black,'audioPeakDbFS':20*math.log10(peak),'audioRmsDbFS':20*math.log10(rms),'reviewFrames':review,'inputRecordings':inputs,'localDemoVerification':{'caseCount':1,'caseStatus':'draft','complexId':'SQ-001','verifiedAssertions':1,'factor':'R2','comment':fact['comment']}}
(R/'out/ffprobe.json').write_text(json.dumps(meta,indent=2))
(R/'out/qa-evidence.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(result,indent=2,ensure_ascii=False))

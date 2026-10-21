from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
frames = sorted((root/'out/frames').glob('element-*.png'))
w,h = 480,270
font = ImageFont.truetype(str(root/'public/fonts/Inter.ttf'), 18)
sheet = Image.new('RGB',(4*w, ((len(frames)+3)//4)*(h+38)+90),'#080A0D')
draw = ImageDraw.Draw(sheet)
draw.text((24,18),'SAQ QURYLYS / 15 SEC / 450 FRAMES / DEMO',font=font,fill='#F2F4F6')
for i,path in enumerate(frames):
    frame = int(path.stem.split('-')[-1])
    x,y = (i%4)*w, 70+(i//4)*(h+38)
    with Image.open(path) as image:
        sheet.paste(image.convert('RGB').resize((w,h), Image.Resampling.LANCZOS),(x,y))
    draw.text((x+12,y+h+8),f'F {frame:03d}   /   {frame/30:05.2f}s',font=font,fill='#87919C')
sheet.save(root/'out/saq-qurylus-contact-sheet.png')
print(f'Contact sheet: {len(frames)} frames')

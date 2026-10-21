from pathlib import Path
import zipfile

root=Path(__file__).resolve().parent.parent
archive=root/'out/saq-qurylus-project.zip'
files=[]
for folder in ['src','public','scripts']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
files.extend(root/name for name in ['package.json','package-lock.json','tsconfig.json','remotion.config.ts','README.md','.gitignore'])
files.extend(root/'out'/name for name in ['saq-qurylus-teaser.mp4','saq-qurylus-cover.png','saq-qurylus-contact-sheet.png','validation.json','ffprobe.json','audio-synthesis.json','music-edit.json','review.html'])
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files:
        z.write(p,p.relative_to(root.parent))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
print(f'Packaged {len(files)} files; {archive.stat().st_size/1048576:.1f} MiB: {archive}')

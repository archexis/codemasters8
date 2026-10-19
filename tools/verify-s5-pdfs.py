from pathlib import Path
import pypdf,pypdfium2 as pdfium,json
out=[]
for path in Path('docs/acceptance/s5/pdf').glob('*.pdf'):
 reader=pypdf.PdfReader(path); text='\n'.join(p.extract_text() for p in reader.pages)
 expected=['SQ-002','revision 1','70','PDF-'+path.stem] if path.stem!='connected' else [json.loads(Path('docs/acceptance/s5/connected.json').read_text(encoding='utf-8'))['zkId'],'revision 1','70','Подтверждён']
 for token in expected: assert token in text,(path,token)
 if path.stem=='long': assert 'Құрылыс' in text and len(reader.pages)>1
 doc=pdfium.PdfDocument(str(path))
 for i,page in enumerate(doc): page.render(scale=1.1).to_pil().save(path.with_name(path.stem+f'-{i+1}.png'))
 path.with_suffix('.txt').write_text(text,encoding='utf-8');out.append({'fixture':path.stem,'pages':len(reader.pages),'textChecks':'PASS'})
Path('docs/acceptance/s5/pdf/text-checks.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(out)

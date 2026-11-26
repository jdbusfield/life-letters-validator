"""Build screen-only transparent atlases from the designer's final PDFs."""
import hashlib,json,pathlib,sys
import pypdfium2 as pdfium
from PIL import Image
source=pathlib.Path(sys.argv[1]).expanduser() if len(sys.argv)>1 else pathlib.Path.home()/'Downloads'
dest=pathlib.Path(__file__).resolve().parents[1]/'public/assets/card-preview'
dest.mkdir(parents=True,exist_ok=True)
scale=1.5;tile=(486,621);columns=4;rows=7
manifest={'version':'20261125','width':324,'height':414,'trim':{'x':9,'y':9,'width':306,'height':396},'columns':columns,'rows':rows,'colors':{}}
for color in ['blue','pink','green','orange','yellow']:
 pdf=source/f'Life Letters Cards LC v8 {"blue (1)" if color=="blue" else color}.pdf'
 doc=pdfium.PdfDocument(str(pdf))
 assert len(doc)==56
 data={'sourceSha256':hashlib.sha256(pdf.read_bytes()).hexdigest()}
 for side,indices in [('front',[2]+list(range(4,56,2))),('back',[3]+list(range(5,56,2)))]:
  atlas=Image.new('RGBA',(tile[0]*columns,tile[1]*rows),(255,255,255,0))
  for index,page_index in enumerate(indices):
   page=doc[page_index];assert tuple(page.get_size())==(324,414)
   bitmap=page.render(scale=scale,fill_color=(0,0,0,0))
   image=bitmap.to_pil().convert('RGBA')
   atlas.paste(image,((index%columns)*tile[0],(index//columns)*tile[1]))
   if side=='back' and index==1:data['answerPanel']='#%02x%02x%02x'%image.getpixel((78,412))[:3]
   bitmap.close();page.close()
  filename=f'{color}-{side}.webp'
  atlas.save(dest/filename,format='WEBP',quality=92,method=6,exact=True)
  data[side]=f'/assets/card-preview/{filename}?v=20261125'
  print(color,side,(dest/filename).stat().st_size,flush=True)
 manifest['colors'][color]=data;doc.close()
(dest/'manifest.json').write_text(json.dumps(manifest,indent=2))

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.pdfencrypt import StandardEncryption
import sys
root=Path(__file__).resolve().parents[3]
out=root/'tests/fixtures/documents'
font=ImageFont.truetype(str(root/'public/fonts/geist-mono-medium.ttf'), 44)

def image(lines, width=1900):
    img=Image.new('RGB',(width,100+len(lines)*88),'white')
    d=ImageDraw.Draw(img)
    for i,line in enumerate(lines):d.text((65,40+i*88),line,font=font,fill='black')
    return img

hybrid=image(['1791C - Prepend and Append'])
hybrid.save(out/'hybrid-source.png')
c=canvas.Canvas(str(out/'hybrid.pdf'),pagesize=(612,792),pageCompression=1)
c.setFont('Helvetica-Bold',18);c.drawString(44,738,'Stage 1: Selectable foundations')
c.setFont('Helvetica',15);c.drawString(44,688,'381A - Sereja and Dima')
c.linkURL('https://codeforces.com/contest/381/problem/A',(42,684,440,706),relative=0,thickness=0)
c.setFont('Helvetica-Bold',18);c.drawString(44,620,'Stage 2: Image practice')
c.drawImage(ImageReader(hybrid),20,525,width=570,height=570*hybrid.height/hybrid.width)
c.setFont('Helvetica-Bold',18);c.drawString(44,475,'Stage 3: Intentional revisit')
c.setFont('Helvetica',15);c.drawString(44,425,'381A - Repeated membership')
c.linkURL('https://codeforces.com/problemset/problem/381/A',(42,421,440,443),relative=0,thickness=0)
c.save()
c=canvas.Canvas(str(out/'decorative-image.pdf'),pagesize=(612,792),pageCompression=1)
c.setFont('Helvetica-Bold',18);c.drawString(44,738,'Stage 1: Foundations')
c.setFont('Helvetica',15);c.drawString(44,688,'381A - Sereja and Dima')
logo=Image.new('RGB',(32,32),'#2c5945');c.drawImage(ImageReader(logo),550,732,width=16,height=16);c.save();logo.close()
if '--hybrid-only' in sys.argv:
    print('Generated hybrid.pdf, hybrid-source.png and decorative-image.pdf')
    sys.exit(0)

all_lines=['Stage 1: Foundations','381A - Sereja and Dima','279B - Books','Stage 2: Variants','1739C1 - Easy variant','1739C2 - Hard variant','38IA - Ambiguous printed ID','A title without an ID']
screenshot=image(all_lines)
screenshot.save(out/'screenshot.png')
screenshot.save(out/'screenshot.jpg',quality=94)
(out/'corrupt.png').write_bytes((out/'screenshot.png').read_bytes()[:24])
scan=image(['Stage 1: Foundations','381A - Sereja and Dima','279B - Books','Stage 2: Variants','1739C1 - Easy variant','1739C2 - Hard variant'])
scan.save(out/'scan-source.png')
variant=image(['Stage 2: Variants','1739C1 - Easy variant','1739C2 - Hard variant'])
variant.save(out/'mixed-scan-source.png')

def page_text(c, second=False):
    c.setFont('Helvetica-Bold',18)
    c.drawString(44,738,'Stage 2: Variants' if second else 'Stage 1: Foundations')
    c.setFont('Helvetica',15)
    rows= [('1739C1 - Easy variant','https://codeforces.com/contest/1739/problem/C1'),('1739C2 - Hard variant','https://codeforces.com/problemset/problem/1739/C2'),('381A - Duplicate membership','https://codeforces.com/problemset/problem/381/A'),('A title without a link',None),('381A - Conflicting link','https://codeforces.com/contest/279/problem/B')] if second else [('Sereja and Dima','https://codeforces.com/contest/381/problem/A'),('Books','https://codeforces.com/problemset/problem/279/B')]
    for i,(text,url) in enumerate(rows):
        y=684-i*48
        c.drawString(44,y,text)
        if url:c.linkURL(url,(42,y-4,440,y+18),relative=0,thickness=0)

c=canvas.Canvas(str(out/'text-links.pdf'),pagesize=(612,792),pageCompression=1)
page_text(c);c.showPage();page_text(c,True);c.save()
c=canvas.Canvas(str(out/'scanned.pdf'),pagesize=(612,792),pageCompression=1)
c.drawImage(ImageReader(scan),20,420,width=570,height=570*scan.height/scan.width);c.save()
c=canvas.Canvas(str(out/'mixed.pdf'),pagesize=(612,792),pageCompression=1)
page_text(c);c.showPage();c.drawImage(ImageReader(variant),20,560,width=570,height=570*variant.height/variant.width)
c.setFont('Helvetica',8);c.drawString(302,18,'2');c.save()
c=canvas.Canvas(str(out/'encrypted.pdf'),pagesize=(612,792),encrypt=StandardEncryption('fixture-password',ownerPassword='fixture-owner'))
c.drawString(44,720,'381A - Encrypted');c.save()
c=canvas.Canvas(str(out/'too-many-pages.pdf'),pagesize=(612,792))
for i in range(41):c.drawString(44,720,f'Stage {i+1}: 381A');c.showPage()
c.save()
c=canvas.Canvas(str(out/'scan-with-heading.pdf'),pagesize=(612,792),pageCompression=1)
c.setFont('Helvetica-Bold',18);c.drawString(44,738,'Stage 2: A long selectable section heading')
c.drawImage(ImageReader(variant),20,560,width=570,height=570*variant.height/variant.width);c.save()
large=Image.new('RGB',(5000,5000),'white');ImageDraw.Draw(large).text((65,40),'381A - Oversized scan',font=font,fill='black')
c=canvas.Canvas(str(out/'oversized-scan.pdf'),pagesize=(612,792),pageCompression=1);c.drawImage(ImageReader(large),20,120,width=570,height=570);c.save();large.close()
(out/'corrupt.pdf').write_bytes(b'%PDF-1.7\nThis is not a valid PDF document.\n')
print('\n'.join(f'{p.name}: {p.stat().st_size} bytes' for p in out.iterdir()))

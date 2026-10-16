from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
S = 4
im = Image.new('RGBA', (512,512))
mask = Image.new('L', im.size)
ImageDraw.Draw(mask).rounded_rectangle((16,16,496,496),radius=124,fill=255)
pixels = im.load()
for y in range(512):
    for x in range(512):
        t=(x+y)/1024
        pixels[x,y]=(int(113-47*t),int(139-55*t),int(255-56*t),255)
im.putalpha(mask)
d=ImageDraw.Draw(im)
def poly(points,fill):
    d.polygon([(x*S,y*S) for x,y in points],fill=fill)
poly([(35,32),(79,32),(94,47),(94,58),(82,58),(82,48),(44,48),(44,88),(82,88),(82,77),(94,77),(94,96),(35,96)],'#e3edff')
poly([(27,89),(55,59),(74,76),(99,47),(108,55),(75,93),(56,76),(36,98)],'#ffffff')
poly([(74,76),(83,66),(92,74),(83,84)],'#a8bfff')
d.ellipse((56*S,44*S,66*S,54*S),fill='#c5e1ff')
im.save(ROOT/'assets'/'logo.png')
im.save(ROOT/'assets'/'logo.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

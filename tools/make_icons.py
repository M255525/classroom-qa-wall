# 產生 PWA 圖示：軟木板＋三張便條紙＋紅色圖釘
import os
from PIL import Image, ImageDraw
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(out, exist_ok=True)

def draw(size, pad):
    s = 4 * size
    im = Image.new('RGB', (s, s), '#3B2A1E')
    d = ImageDraw.Draw(im)
    x0, x1 = pad * s, (1 - pad) * s
    w = x1 - x0
    d.rounded_rectangle([x0 + w * .06, x0 + w * .06, x0 + w * .94, x0 + w * .94], radius=w * .08, fill='#C49A6C')
    import random
    random.seed(3)
    for _ in range(int(w * w / 900)):
        cx, cy = x0 + w * (.08 + random.random() * .84), x0 + w * (.08 + random.random() * .84)
        r = w * .006
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=random.choice(['#9B7148', '#D9B48A']))
    notes = [(.14, .16, .56, .5, '#FFF59D'), (.46, .3, .86, .64, '#B9F0D9'), (.2, .56, .62, .88, '#FFCDC4')]
    for (a, b, c, e, col) in notes:
        d.rectangle([x0 + w * a + w * .015, x0 + w * b + w * .02, x0 + w * c + w * .015, x0 + w * e + w * .02], fill='#7A5532')
        d.rectangle([x0 + w * a, x0 + w * b, x0 + w * c, x0 + w * e], fill=col)
        for k in range(2):
            y = x0 + w * (b + .12 + k * .09)
            d.line([x0 + w * (a + .06), y, x0 + w * (c - .08 - k * .08), y], fill='#6E5E4E', width=int(w * .018))
        px, py, pr = x0 + w * (a + c) / 2, x0 + w * (b + .03), w * .045
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill='#E23E3E', outline='#8E1B1B', width=int(w * .008))
    # 問號
    d.text((0, 0), '')
    return im.resize((size, size), Image.LANCZOS)

draw(192, .04).save(os.path.join(out, 'icon-192.png'))
draw(512, .04).save(os.path.join(out, 'icon-512.png'))
draw(512, .16).save(os.path.join(out, 'icon-maskable-512.png'))
print('ok')

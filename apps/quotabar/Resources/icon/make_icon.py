# Draws Resources/AppIcon.png: python3 make_icon.py ../AppIcon.png <Anthropic Sans .ttf>
"""QuotaBar's app icon: a usage gauge in Bilibili pink on Bilibili blue, "AI" inside."""
import math, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 4096                      # drawn large, scaled down to 1024 for smooth edges
BLUE, BLUE2, PINK = (0, 174, 236), (0, 132, 206), (251, 114, 153)
out, font_path = sys.argv[1], sys.argv[2]

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# The macOS icon grid: an 824/1024 rounded square, a little room for the shadow.
m, r = S * 100 // 1024, S * 185 // 1024
box = (m, m, S - m, S - m)

shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((box[0], box[1] + S // 60, box[2], box[3] + S // 60), r, fill=(0, 40, 80, 110))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(S // 70)))

# Blue, lighter at the top left.
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    gd.line([(0, y), (S, y)], fill=tuple(int(BLUE[i] * (1 - t) + BLUE2[i] * t) for i in range(3)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, r, fill=255)
img.paste(grad, (0, 0), mask)

# The gauge: a 270° ring open at the bottom, two thirds used, in pink.
# The track goes on a layer of its own, so its transparency blends with the blue.
track = Image.new("RGBA", (S, S), (0, 0, 0, 0))
td = ImageDraw.Draw(track)
d = ImageDraw.Draw(img)
c, R, w = S // 2, S * 290 // 1024, S * 78 // 1024
ring = (c - R, c - R + S // 40, c + R, c + R + S // 40)
start, end, used = 135, 405, 0.68
td.arc(ring, start, end, fill=(255, 255, 255, 255), width=w)
def tcap(a):
    x = c + (R - w / 2) * math.cos(math.radians(a))
    y = c + S // 40 + (R - w / 2) * math.sin(math.radians(a))
    td.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=(255, 255, 255, 255))
tcap(end)
track.putalpha(track.getchannel("A").point(lambda v: v * 60 // 255))
img.alpha_composite(track)
d.arc(ring, start, start + (end - start) * used, fill=PINK, width=w)
def cap(a, col):
    x = c + (R - w / 2) * math.cos(math.radians(a))
    y = c + S // 40 + (R - w / 2) * math.sin(math.radians(a))
    d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=col)
cap(start, PINK); cap(start + (end - start) * used, PINK)
# The end of the used part, a white dot on the pink.
a = math.radians(start + (end - start) * used)
x, y = c + (R - w / 2) * math.cos(a), c + S // 40 + (R - w / 2) * math.sin(a)
d.ellipse((x - w * 0.22, y - w * 0.22, x + w * 0.22, y + w * 0.22), fill=(255, 255, 255))

# "AI" in the middle, with a sparkle.
f = ImageFont.truetype(font_path, S * 215 // 1024)
try:
    f.set_variation_by_axes([780, 48])
except Exception:
    pass
tb = d.textbbox((0, 0), "AI", font=f)
tx, ty = c - (tb[0] + tb[2]) / 2, c + S // 40 - (tb[1] + tb[3]) / 2
d.text((tx, ty), "AI", font=f, fill=(255, 255, 255))
def sparkle(cx, cy, s, col):
    pts = []
    for i in range(8):
        ang = math.radians(i * 45 - 90)
        rr = s if i % 2 == 0 else s * 0.28
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    d.polygon(pts, fill=col)
right = tx + tb[2]
sparkle(right + S * 34 // 1024, ty + tb[1] + S * 8 // 1024, S * 44 // 1024, PINK)
sparkle(right + S * 70 // 1024, ty + tb[1] + S * 60 // 1024, S * 20 // 1024, (255, 255, 255))

img.resize((1024, 1024), Image.LANCZOS).save(out)

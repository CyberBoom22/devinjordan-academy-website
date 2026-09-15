# Brand source artwork

Master files the web assets in `public/img/` are generated from. Deliberately
outside `public/`, which Astro copies verbatim to the web root — these are build
inputs, not things to serve.

## logo-source.png

The academy crest, 230x230 with a genuine alpha channel. `public/img/logo.webp`
is generated from it:

```python
from PIL import Image
src = Image.open('brand/logo-source.png').convert('RGBA')
src.save('public/img/logo.webp', 'WEBP', lossless=True, quality=100, method=6)
```

Lossless rather than lossy: the crest is flat gold and maroon with hard edges
and fine filigree, which is exactly what lossy codecs smear. It also happens to
be smaller than a lossy encode of the same image, so there is nothing to trade.

**230x230 is the largest version we have.** It came from the previous GoDaddy
site, whose image CDN will not upscale past its own stored original. If the
academy can find the artwork the designer delivered, a larger master would let
the logo render sharply on high-density screens, where 230px is currently
upscaled roughly two to three times. Drop it in here and re-run the snippet
above.

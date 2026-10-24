"""Subset the LABDAM brand fonts to the characters used on index.html.

Usage: python scripts/subset-home-fonts.py <folder with the full woff2 files>
Needs: pip install fonttools brotli
Rerun after changing the homepage text; characters missing from the subset
fall back to the system font.
"""
import re
import string
import sys
from pathlib import Path

from fontTools import subset

FONTS = ["Pretendard-Regular", "Pretendard-SemiBold", "WantedSans-Bold", "WantedSans-ExtraBold"]

html = Path("index.html").read_text(encoding="utf-8")
body = re.sub(r"<(style|head)\b.*?</\1>", " ", html, flags=re.S)
text = re.sub(r"<[^>]+>", " ", body) + string.printable + "·→↗"

src = Path(sys.argv[1])
for name in FONTS:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]  # keep the OFL copyright and license records
    font = subset.load_font(src / f"{name}.woff2", options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    out = Path("assets/fonts") / f"{name}-home.woff2"
    subset.save_font(font, out, options)
    print(out, out.stat().st_size, "bytes")

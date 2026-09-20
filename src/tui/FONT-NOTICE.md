# VGA character data

`vgaFont.ts` embeds the 4,096-byte IBM VGA 9x16 character bitmap preserved by
VileR in [vga-text-mode-fonts](https://github.com/viler-int10h/vga-text-mode-fonts/blob/master/FONTS/PC-IBM/VGA9.F16).
The bitmap is stored verbatim as base64; the Unicode mapping is CP437.

`bgiFont.ts` embeds the 2,048-byte IBM BIOS 8x8 bitmap from the same archive's
[BIOS.F08](https://github.com/viler-int10h/vga-text-mode-fonts/blob/master/FONTS/PC-IBM/BIOS.F08)
for the BGI default graphics font. It uses the same CP437 mapping.

Credit for the original character designs belongs to IBM. VileR's
[documentation](https://int10h.org/oldschool-pc-fonts/readme/#legal_stuff)
distinguishes this original raw raster data from the separately licensed
TrueType/FON font remakes. This app uses the raw raster data, not those remakes
or any BIOS executable code.

Rendering adds the VGA ninth column for line graphics (codes B0–DF), then
scales the finished image with nearest-neighbor sampling. The font is bundled
with the app and does not require a network request or an installed system font.

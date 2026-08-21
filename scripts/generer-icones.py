#!/usr/bin/env python3
"""
Genere les icones PWA sans dependance externe.

Pourquoi un generateur plutot que deux fichiers binaires : l'icone reste
reproductible et modifiable dans le depot. Un PNG commite est opaque — on ne
sait plus comment le regenerer six mois plus tard.

Motif : un radar. Anneaux concentriques sur le teal de la marque, et un point
orange (la teinte DPE F) en haut a droite — le bien detecte.
Le dessin tient dans la zone sure des icones « maskable » (80 % centraux),
sans quoi Android en rognerait les bords.
"""
import struct
import zlib
from pathlib import Path

TEAL = (0x0F, 0x5E, 0x5C)
RING = (0xFF, 0xFF, 0xFF)
BLIP = (0xE0, 0x7A, 0x35)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, size: int, pixels: list[list[tuple[int, int, int]]]) -> None:
    raw = b"".join(
        b"\x00" + b"".join(bytes(px) for px in row) for row in pixels
    )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def blend(base, top, alpha):
    return tuple(round(b + (t - b) * alpha) for b, t in zip(base, top))


def draw(size: int) -> list[list[tuple[int, int, int]]]:
    cx = cy = (size - 1) / 2
    # Zone sure « maskable » : on reste dans les 80 % centraux.
    safe = size * 0.40
    rings = [safe * 0.42, safe * 0.68, safe * 0.94]
    thickness = max(1.0, size * 0.022)

    blip_r = size * 0.055
    blip_x = cx + safe * 0.52
    blip_y = cy - safe * 0.52

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            color = TEAL
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5

            for index, radius in enumerate(rings):
                edge = abs(dist - radius)
                if edge < thickness:
                    # Adoucissement des bords : evite l'escalier sur les cercles.
                    alpha = (1 - edge / thickness) * (0.30 + 0.16 * index)
                    color = blend(color, RING, alpha)

            bd = ((x - blip_x) ** 2 + (y - blip_y) ** 2) ** 0.5
            if bd < blip_r + 1:
                alpha = min(1.0, max(0.0, blip_r + 1 - bd))
                color = blend(color, BLIP, alpha)

            row.append(color)
        rows.append(row)
    return rows


if __name__ == "__main__":
    public = Path(__file__).resolve().parent.parent / "public"
    for size in (192, 512):
        target = public / f"icone-{size}.png"
        write_png(target, size, draw(size))
        print(f"{target.name} : {target.stat().st_size} octets")

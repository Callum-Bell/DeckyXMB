"""
Reads PS3 theme files (.p3t).

A .p3t is a tree of named elements (theme > infotable/icontable/bgimagetable/...)
whose attributes are ints, strings, ids or files; files are zlib-compressed and
packed after the tree. Icons are GIM images (converted to PNG here); backgrounds
are JPEGs. Dynamic themes also carry an animated scene (RAF), unpacked by raf.py
into scene.json, script.vsmx and texN.z for the frontend to render.
"""

import json
import os
import re
import struct
import zlib

NONE = 0xFFFFFFFF


class P3TError(Exception):
    pass


def _cstr(buf: bytes, off: int) -> str:
    end = buf.index(b"\0", off)
    return buf[off:end].decode("utf-8", "replace")


class FileRef:
    """A file packed in the tree, read on demand (.p3t files are zlib-compressed, RAF's aren't)."""

    def __init__(self, raw: bytes, compressed: bool):
        self.raw, self.compressed = raw, compressed

    def read(self) -> bytes:
        if self.compressed:
            try:
                return zlib.decompress(self.raw)
            except zlib.error:
                pass  # stored uncompressed
        return self.raw


def parse(data: bytes, compressed: bool = True) -> list:
    """
    The element tree (of a .p3t, or a RAF scene) as a flat list of (depth, name, attrs).
    Files become FileRefs; ids, and references to the element with an id, become that id.
    """
    if data[:4] not in (b"P3TF", b"RAFO"):
        raise P3TError("not a PS3 theme file")
    (_, _ver, hs, ts, ido, idz, so, sz, io, iz, fo, fz, do, dz) = struct.unpack(">4s13I", data[:56])
    tree, ids, strs, files = data[hs : hs + ts], data[ido : ido + idz], data[so : so + sz], data[do : do + dz]
    ints = struct.unpack(">%di" % (iz // 4), data[io : io + iz - iz % 4])
    floats = struct.unpack(">%df" % (fz // 4), data[fo : fo + fz - fz % 4])
    out = []

    # Iterative walk (first child, then next sibling), so a broken file can't recurse forever.
    stack = [(0, 0)]
    seen = set()
    while stack:
        off, depth = stack.pop()
        if off in seen or off + 28 > len(tree):
            continue
        seen.add(off)
        name, n, _parent, _prev, nxt, first, _last = struct.unpack(">7I", tree[off : off + 28])
        attrs = {}
        for i in range(n):
            a = off + 28 + 16 * i
            an, kind, v1, v2 = struct.unpack(">4I", tree[a : a + 16])
            key = _cstr(strs, an)
            if kind == 1:
                attrs[key] = v1 - (1 << 32) if v1 & 0x80000000 else v1
            elif kind == 2:
                attrs[key] = struct.unpack(">f", struct.pack(">I", v1))[0]
            elif kind == 3:
                attrs[key] = _cstr(strs, v1)
            elif kind == 4:
                attrs[key] = list(ints[v1 : v1 + v2])
            elif kind == 5:
                attrs[key] = list(floats[v1 : v1 + v2])
            elif kind == 6:
                attrs[key] = FileRef(files[v1 : v1 + v2], compressed)
            elif kind in (7, 8):
                attrs[key] = _cstr(ids, v1 + 4)  # each id is stored after a 4-byte back reference
        out.append((depth, _cstr(strs, name), attrs))
        if nxt != NONE:
            stack.append((nxt, depth))
        if first != NONE:
            stack.append((first, depth + 1))
    return out


# GIM → PNG

def _png(width: int, height: int, rgba: bytes) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    stride = width * 4
    raw = b"".join(b"\0" + rgba[y * stride : (y + 1) * stride] for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def _unswizzle(buf: bytes, pitch: int, rows: int) -> bytes:
    """PSP 'faststorage' order: 16-byte x 8-row tiles."""
    out = bytearray(len(buf))
    src = 0
    for ty in range(0, rows, 8):
        for tx in range(0, pitch, 16):
            for y in range(ty, min(ty + 8, rows)):
                d = y * pitch + tx
                out[d : d + 16] = buf[src : src + 16]
                src += 16
    return bytes(out)


def _expand(fmt: int, px: bytes, count: int, big: bool) -> bytes:
    """Direct-colour pixels (as 16 or 32-bit words) to RGBA8888."""
    if fmt == 3:  # already R, G, B, A bytes (in both byte orders)
        return px[: 4 * count]
    out = bytearray(4 * count)
    for i in range(count):
        v = struct.unpack_from(">H" if big else "<H", px, 2 * i)[0]
        if fmt == 0:  # RGBA5650
            r, g, b, a = (v & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, ((v >> 11) & 31) * 255 // 31, 255
        elif fmt == 1:  # RGBA5551
            r, g, b, a = (v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255 if v >> 15 else 0
        else:  # RGBA4444
            r, g, b, a = (v & 15) * 17, ((v >> 4) & 15) * 17, ((v >> 8) & 15) * 17, (v >> 12) * 17
        out[4 * i : 4 * i + 4] = bytes((r, g, b, a))
    return bytes(out)


def gim_to_png(gim: bytes) -> bytes:
    """The first image of a GIM as a PNG (direct colour and 4/8-bit palettes)."""
    big = gim[:4] == b".GIM"
    if not big and gim[:4] != b"MIG.":
        raise P3TError("not a GIM image")
    e = ">" if big else "<"
    image = palette = None
    off, end = 16, len(gim)
    blocks = [(off, end)]
    while blocks:
        off, end = blocks.pop()
        while off + 16 <= end:
            kind, _, size, nxt, doff = struct.unpack(e + "HHIII", gim[off : off + 16])
            if kind in (2, 3):
                blocks.append((off + doff, off + size))
            elif kind == 4 and image is None:
                image = off + doff
            elif kind == 5 and palette is None:
                palette = off + doff
            if not size:
                break
            off += size
    if image is None:
        raise P3TError("GIM has no image")

    def header(at: int):
        h = struct.unpack(e + "HHHHHHHHH", gim[at : at + 18])
        start = struct.unpack(e + "I", gim[at + 0x1C : at + 0x20])[0]
        stop = struct.unpack(e + "I", gim[at + 0x20 : at + 0x24])[0]
        return h[2], h[3], h[4], h[5], h[6], at + start, at + stop

    fmt, order, w, h, bpp, start, stop = header(image)
    data = gim[start:stop]
    bits = {0: 16, 1: 16, 2: 16, 3: 32, 4: 4, 5: 8}.get(fmt)
    if bits is None:
        raise P3TError(f"unsupported GIM format {fmt}")
    rows = h if h else 1
    pitch = len(data) // rows if rows else 0
    if order == 1:
        data = _unswizzle(data, pitch, rows)
    if fmt in (4, 5):
        if palette is None:
            raise P3TError("indexed GIM without a palette")
        pfmt, _, pw, _, _, pstart, pstop = header(palette)
        colours = _expand(pfmt, gim[pstart:pstop], pw, big)
        rgba = bytearray()
        for y in range(h):
            row = data[y * pitch : (y + 1) * pitch]
            for x in range(w):
                idx = (row[x >> 1] >> (4 * (x & 1))) & 15 if fmt == 4 else row[x]
                rgba += colours[4 * idx : 4 * idx + 4]
        return _png(w, h, bytes(rgba))
    bpp_bytes = bits // 8
    rgba = b"".join(_expand(fmt, data[y * pitch : y * pitch + w * bpp_bytes], w, big) for y in range(h))
    return _png(w, h, rgba)


# install

def _install_scene(blob: bytes, dest: str) -> bool:
    """Unpack a dynamic theme's RAF scene; False (still background only) if it can't be."""
    import raf  # py_modules/raf.py

    try:
        if blob[:4] == b"_RAF":  # "_RAF", size, then the zlib-compressed scene
            blob = zlib.decompress(blob[8:])
        scene, textures, script = raf.export(blob)
        with open(os.path.join(dest, "scene.json"), "w", encoding="utf-8") as f:
            json.dump(scene, f, separators=(",", ":"))
        with open(os.path.join(dest, "script.vsmx"), "wb") as f:
            f.write(script)
        for i, t in enumerate(textures):
            with open(os.path.join(dest, f"tex{i}.z"), "wb") as f:
                f.write(zlib.compress(t, 6))
        return True
    except Exception:
        return False

def theme_id(name: str, data: bytes) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "theme"
    return f"{slug}-{zlib.crc32(data) & 0xFFFFFFFF:08x}"


def install(path: str, root: str, data: bytes = None) -> dict:
    """
    Unpack a .p3t into root/<id>/: theme.json, icons/<ps3 id>.png, the background
    (background.jpg; a dynamic theme with no still image uses its preview, background.png),
    its preview (screenshot.png) and the theme's own icon (thumb.png). `data` is the .p3t when it came out of a package.
    """
    if data is None:
        with open(path, "rb") as f:
            data = f.read()
    tree = parse(data)
    info = next((a for _, n, a in tree if n == "info"), {})
    name = info.get("name") or os.path.splitext(os.path.basename(path))[0]
    tid = theme_id(name, data)
    dest = os.path.join(root, tid)
    os.makedirs(os.path.join(dest, "icons"), exist_ok=True)

    icons = []
    for _, n, a in tree:
        if n == "icon" and isinstance(a.get("src"), FileRef) and a.get("id"):
            try:
                png = gim_to_png(a["src"].read())
            except Exception:
                continue  # skip an icon we can't read rather than the whole theme
            with open(os.path.join(dest, "icons", a["id"] + ".png"), "wb") as f:
                f.write(png)
            icons.append(a["id"])

    background = ""
    dynamic = False
    scene = False
    for _, n, a in tree:
        if n == "bgimage":
            if isinstance(a.get("anim"), FileRef) and not scene:
                dynamic = True
                scene = _install_scene(a["anim"].read(), dest)
            img = a.get("hd") or a.get("sd")
            if isinstance(img, FileRef) and not background:
                with open(os.path.join(dest, "background.jpg"), "wb") as f:
                    f.write(img.read())
                background = "background.jpg"
    # The theme's preview (a picture of the XMB with it on), shown while choosing it.
    preview = None
    if isinstance(info.get("preview"), FileRef):
        try:
            preview = gim_to_png(info["preview"].read())
            with open(os.path.join(dest, "screenshot.png"), "wb") as f:
                f.write(preview)
        except Exception:
            preview = None
    if not background and preview:
        # Dynamic themes often have no still background: their preview shows the scene.
        with open(os.path.join(dest, "background.png"), "wb") as f:
            f.write(preview)
        background = "background.png"

    # The theme's own icon (64×64), shown beside its name in the theme list.
    if isinstance(info.get("icon"), FileRef):
        try:
            with open(os.path.join(dest, "thumb.png"), "wb") as f:
                f.write(gim_to_png(info["icon"].read()))
        except Exception:
            pass

    meta = {
        "id": tid,
        "name": name,
        "author": info.get("author", ""),
        "comment": info.get("comment", ""),
        "file": os.path.basename(path),
        "icons": icons,
        "background": background,
        "dynamic": dynamic,
        "scene": scene,  # its animated scene could be unpacked (else the still background is used)
    }
    with open(os.path.join(dest, "theme.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta

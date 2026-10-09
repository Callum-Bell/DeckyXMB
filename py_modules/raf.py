"""
Reads the animated scene of a PS3 dynamic theme (RAF) into something a browser can draw.

A RAF uses the same element tree as a .p3t. Its scene has actors (a model + material each),
a camera, lights and a script (VSMX: compiled JavaScript). Models are PS3 "Edge" data:
  .edge  geometry, in segments: compressed triangle indexes, float positions, packed
         normals, half-float UVs and vertex colours, and skinning (up to 4 weighted joints per vertex)
  .skel  skeleton: joint parents and base pose (rotation, translation, scale)
  .anim  animation: bit-packed rotation/translation/scale keyframes, decoded here
Textures are GTF (DXT1/3/5 with their mipmaps, or 32-bit), passed through for the
browser to upload.

Only what these scenes use is supported; anything else raises RafError, and the theme
then falls back to its still background.
"""

import math
import struct

from p3t import FileRef, parse


class RafError(Exception):
    pass


class _Bits:
    def __init__(self, b: bytes):
        self.v = int.from_bytes(b, "big")
        self.n = len(b) * 8
        self.p = 0

    def read(self, k: int) -> int:
        if k == 0:
            return 0
        if self.p + k > self.n:
            raise RafError("ran past the end of packed data")
        r = (self.v >> (self.n - self.p - k)) & ((1 << k) - 1)
        self.p += k
        return r


# geometry (.edge)

# A triangle that shares an edge with the previous one (a, b, c) adds one index n:
# code 0 → (a, c, n), 1 → (c, b, n), 2 → (b, a, n); code 3 is a new triangle.
_SHARE = {0: (0, 2), 1: (2, 1), 2: (1, 0)}


def _indexes(blob: bytes, num_indexes: int) -> list:
    """Edge compressed indexes: a bit per needed index (next new vertex / back-reference),
    2 bits per triangle, then back-references (each relative to the one 8 earlier)."""
    _ndelta, bias, seq_bytes, dbits, _ = struct.unpack(">HHHBB", blob[:8])
    ntri = num_indexes // 3
    seq = _Bits(blob[8 : 8 + seq_bytes])
    tri = _Bits(blob[8 + seq_bytes : 8 + seq_bytes + (ntri * 2 + 7) // 8])
    deltas = _Bits(blob[8 + seq_bytes + (ntri * 2 + 7) // 8 :])
    codes = [tri.read(2) for _ in range(ntri)]
    refs = []
    nxt = 0

    def get():
        nonlocal nxt
        if seq.read(1) == 0:
            nxt += 1
            return nxt - 1
        v = deltas.read(dbits) + (refs[-8] if len(refs) >= 8 else 0) - bias
        refs.append(v)
        return v

    out = []
    prev = None
    for c in codes:
        if c == 3 or prev is None:
            t = (get(), get(), get())
        else:
            i, j = _SHARE[c]
            t = (prev[i], prev[j], get())
        out.extend(t)
        prev = t
    return out


def _stream_desc(data: bytes, off: int):
    n, stride = data[off], data[off + 1]
    attrs = []
    for i in range(n):
        o = off + 8 + 8 * i
        attrs.append({"offset": data[o], "format": data[o + 1], "count": data[o + 2], "id": data[o + 3]})
    return stride, attrs


def _read_attr(data: bytes, base: int, stride: int, a: dict, nverts: int) -> list:
    fmt, cnt, off = a["format"], a["count"], a["offset"]
    out = []
    for v in range(nverts):
        p = base + v * stride + off
        if fmt == 2:
            out.extend(struct.unpack(">%df" % cnt, data[p : p + 4 * cnt]))
        elif fmt == 3:
            out.extend(struct.unpack(">%de" % cnt, data[p : p + 2 * cnt]))
        elif fmt == 4:  # U8 normalised
            out.extend(x / 255 for x in data[p : p + cnt])
        elif fmt == 6:  # X11Y11Z10N: signed, packed into 32 bits
            w = struct.unpack(">I", data[p : p + 4])[0]
            sx = lambda v, n: (v - (1 << n) if v >= 1 << (n - 1) else v) / ((1 << (n - 1)) - 1)
            out.extend((sx(w & 0x7FF, 11), sx((w >> 11) & 0x7FF, 11), sx(w >> 22, 10)))
        else:
            raise RafError(f"unsupported vertex format {fmt}")
    return out


def _segment(data: bytes, seg: bytes) -> dict:
    in_fmt = seg[2]
    nverts, nidx = struct.unpack(">HH", seg[8:12])
    if in_fmt != 0:
        raise RafError(f"unsupported input vertex format {in_fmt}")
    idx_off, idx_size = struct.unpack(">IH", seg[0x10:0x16])
    v0, v1 = struct.unpack(">II", seg[0x18:0x20])
    rsx_off = struct.unpack(">I", seg[0x2C:0x30])[0]
    mat_offs = struct.unpack(">HH", seg[0x34:0x38])
    mat_sizes = struct.unpack(">HH", seg[0x38:0x3C])
    skin_size = struct.unpack(">H", seg[0x3C:0x3E])[0]
    skin_off = struct.unpack(">I", seg[0x40:0x44])[0]
    spu_desc, _out_desc, rsx_desc = struct.unpack(">III", seg[0x6C:0x78])
    pos = list(struct.unpack(">%df" % (3 * nverts), data[v0 : v0 + 12 * nverts]))
    normals = None
    if v1 and spu_desc:
        stride, attrs = _stream_desc(data, spu_desc)
        for a in attrs:
            if a["id"] == 2:
                normals = _read_attr(data, v1, stride, a, nverts)
    uv = None
    colors = None
    if rsx_desc:
        stride, attrs = _stream_desc(data, rsx_desc)
        for a in attrs:
            if a["id"] == 5 and uv is None:  # first texture coordinate
                uv = _read_attr(data, rsx_off, stride, a, nverts)
            elif a["id"] == 9 and a["count"] == 4 and colors is None:
                # Vertex colour (RGBA): atlas themes fade their cards' edges out with its alpha.
                c = _read_attr(data, rsx_off, stride, a, nverts)
                if all(-0.001 <= x <= 1.001 for x in c):  # (only if it looks like a colour)
                    colors = c
    if uv is None:
        uv = [0.0] * (2 * nverts)
    # Skinning: per vertex, up to 4 (weight, joint) byte pairs. Joints index this segment's
    # matrices, which are up to two ranges of the skeleton's joints.
    joints = [0] * (4 * nverts)
    weights = [0.0] * (4 * nverts)
    if (seg[6] & 0x0F) and skin_off and skin_size:
        per = max(2, min(8, skin_size // max(1, nverts)) & ~1)
        first = [mat_offs[0] // 48, mat_offs[1] // 48]
        count0 = mat_sizes[0] // 48
        glob = lambda l: first[0] + l if l < count0 else first[1] + (l - count0)
        for v in range(nverts):
            rec = data[skin_off + per * v : skin_off + per * (v + 1)]
            for k in range(min(4, per // 2)):
                weights[4 * v + k] = rec[2 * k] / 255
                joints[4 * v + k] = glob(rec[2 * k + 1])
    else:
        for v in range(nverts):
            weights[4 * v] = 1.0
    return {
        "positions": pos,
        "normals": normals,
        "uvs": uv,
        "colors": colors,
        "joints": joints,
        "weights": weights,
        "indexes": _indexes(data[idx_off : idx_off + idx_size], nidx),
    }


def _geometry(data: bytes) -> dict:
    nseg, seg_off = struct.unpack(">II", data[:8])
    out = {"positions": [], "normals": [], "uvs": [], "colors": [], "joints": [], "weights": [], "indexes": []}
    has_normals = True
    has_colors = False
    for s in range(nseg):
        seg = data[seg_off + 0x80 * s : seg_off + 0x80 * (s + 1)]
        g = _segment(data, seg)
        base = len(out["positions"]) // 3
        n = len(g["positions"]) // 3
        out["positions"] += g["positions"]
        out["uvs"] += g["uvs"]
        out["joints"] += g["joints"]
        out["weights"] += g["weights"]
        out["indexes"] += [i + base for i in g["indexes"]]
        if g["colors"] is not None:
            has_colors = True
            out["colors"] += g["colors"]
        else:
            out["colors"] += [1.0] * (4 * n)  # (white, opaque) where a segment has none
        if g["normals"] is None:
            has_normals = False
        else:
            out["normals"] += g["normals"]
        if any(i >= n or i < 0 for i in g["indexes"]):
            raise RafError("geometry indexes out of range")
    if not has_normals:
        out["normals"] = []
    if not has_colors:
        del out["colors"]
    for k in ("positions", "normals", "uvs", "colors", "weights"):
        if k not in out:
            continue
        out[k] = [round(x, 5) for x in out[k]]
    return out


# skeleton (.skel) and animation (.anim)

def _skeleton(data: bytes) -> dict:
    if data[:4] != b"ES01":
        raise RafError("not an Edge skeleton")
    n = struct.unpack(">H", data[12:14])[0]
    if n == 0:
        return {"parents": [], "pose": []}
    base = 0x14 + struct.unpack(">I", data[0x14:0x18])[0]
    pose = [[round(x, 6) for x in struct.unpack(">12f", data[base + 48 * j : base + 48 * j + 48])] for j in range(n)]  # quat, trans, scale
    # Parent links: (joint, parent | 0x8000) pairs after a group of root entries (parent 0xffff).
    parents = [-1] * n
    o = 0x30
    while o + 4 <= base:
        j, p = struct.unpack(">HH", data[o : o + 4])
        if p != 0xFFFF and j < n and (p & 0x7FFF) < n:
            parents[j] = p & 0x7FFF
        o += 4
    return {"parents": parents, "pose": pose}


def _comps(spec: int):
    """A channel's packing: for each of 3 values, (sign bits, exponent bits, mantissa bits)."""
    out = []
    for c in range(3):
        v = (spec >> (32 - 10 * (c + 1))) & 1023
        out.append(((v >> 9) & 1, (v >> 5) & 15, v & 31))
    return out


def _spec_bits(spec: int) -> int:
    return sum(s + e + m for s, e, m in _comps(spec))


def _values(bits: _Bits, spec: int) -> list:
    """Three packed values: tiny floats (sign, exponent with an IEEE-style bias, mantissa with
    an implied leading 1, no subnormals), or with no exponent bits fixed point: signed
    (two's complement) in [-1, 1), unsigned in [0, 1] (all ones is 1: a 1-bit scale is 0 or 1)."""
    out = []
    for sb, eb, mb in _comps(spec):
        if eb == 0:
            raw = bits.read(sb + mb)
            if sb:
                if raw >= 1 << (sb + mb - 1):
                    raw -= 1 << (sb + mb)
                out.append(raw / (1 << mb))
            else:
                out.append(raw / max(1, (1 << mb) - 1))
            continue
        s, e, m = bits.read(sb), bits.read(eb), bits.read(mb)
        bias = (1 << (eb - 1)) - 1
        v = 2.0 ** (e - bias) * (1 + m / (1 << mb))
        out.append(-v if s else v)
    return out


def _key(bits: _Bits, spec: int, rotation: bool) -> list:
    v = _values(bits, spec)
    if not rotation:
        return v
    # A rotation stores 3 quaternion components; the one named by the spec's low 2 bits is rebuilt.
    w = math.sqrt(max(0.0, 1.0 - sum(x * x for x in v)))
    v.insert(spec & 3, w)
    return v


def _animation(data: bytes) -> dict:
    """Keyframes per joint: {"rotation"|"translation"|"scale": {joint: [[frame, ...values], ...]}}."""
    if data[:4] != b"EA03":
        raise RafError("not an Edge animation")
    duration, freq = struct.unpack(">ff", data[4:12])
    _hsize, _njoints, nframes, nsets = struct.unpack(">HHHH", data[12:20])
    counts = struct.unpack(">8H", data[0x16:0x26])  # constant R/T/S/user, animated R/T/S/user
    if counts[7]:
        raise RafError("animation uses user channels")
    rel = lambda at: at + struct.unpack(">I", data[at : at + 4])[0]
    dma, info, spec_at = rel(0x34), rel(0x38), rel(0x4C)
    const_at = [rel(0x3C), rel(0x40), rel(0x44)]  # constant R/T/S values
    pad4 = lambda n: (n + 3) // 4 * 4
    kinds = ("rotation", "translation", "scale")
    # Joint lists, each padded to 4 entries: constant R/T/S/user from the start, then animated R/T/S,
    # which end where the constant values begin. (Constant lists can carry more padding: Heavy Rain's
    # cops have 4 more entries between them, so the animated ones are found from that end.)
    t = 0x60
    lists = []
    for n in counts[:4]:
        lists.append(struct.unpack(">%dH" % n, data[t : t + 2 * n]))
        t += 2 * pad4(n)
    t = max(t, const_at[0] - 2 * sum(pad4(n) for n in counts[4:7]))
    for n in counts[4:7]:
        lists.append(struct.unpack(">%dH" % n, data[t : t + 2 * n]))
        t += 2 * pad4(n)
    # Packing specs, per kind: one spec shared by its constant joints, then one per animated joint.
    groups = []
    keys = {kind: {} for kind in kinds}
    o = spec_at
    for g, kind in enumerate(kinds):
        n = counts[4 + g]
        const_spec = struct.unpack(">I", data[o : o + 4])[0]
        specs = struct.unpack(">%dI" % n, data[o + 4 : o + 4 + 4 * n])
        groups.append((kind, lists[4 + g], specs))
        o += 4 + 4 * n
        # Constant joints: one packed value each, held for the whole animation.
        b = _Bits(data[const_at[g] : const_at[g] + (len(lists[g]) * _spec_bits(const_spec) + 7) // 8])
        for j in lists[g]:
            keys[kind][str(j)] = [[0] + _key(b, const_spec, kind == "rotation")]
    channels = [(kind, j, s) for kind, js, ss in groups for j, s in zip(js, ss)]
    for kind, js, _ in groups:
        for j in js:
            keys[kind][str(j)] = []
    for i in range(nsets):
        size, off = struct.unpack(">II", data[dma + 8 * i : dma + 8 * i + 8])
        start, nintra = struct.unpack(">HH", data[info + 4 * i : info + 4 * i + 4])
        if not size and off + 16 > len(data):
            continue  # (the final set, holding just the last frame's keys, has no size)
        h = struct.unpack(">8H", data[off : off + 16])
        base_sizes = [h[0], h[1]]  # rotation, translation; scale fills h[2] with its padding
        p = off + 16
        for (kind, joints, specs), bsize in zip(groups, base_sizes + [None]):
            nbits = sum(_spec_bits(s) for s in specs)
            nbytes = bsize if bsize is not None else (nbits + 7) // 8
            b = _Bits(data[p : p + nbytes])
            for j, s in zip(joints, specs):
                keys[kind][str(j)].append([start] + _key(b, s, kind == "rotation"))
            p += nbytes
        if not size:
            continue
        mask_at = off + 16 + h[0] + h[1] + h[2]
        intra_sizes = [h[4], h[5]]
        if not any(intra_sizes) and not counts[6]:
            continue
        # A bit per intra frame and channel says which frames have keys: one bitstream,
        # nintra bits per channel back to back, then each group's packed keys.
        nch = len(channels)
        mbits = _Bits(data[mask_at : mask_at + (nch * nintra + 7) // 8])
        masks = [[f for f in range(nintra) if mbits.read(1)] for _ in range(nch)]
        need = [0, 0, 0]
        for c, (kind, _j, s) in enumerate(channels):
            need[("rotation", "translation", "scale").index(kind)] += len(masks[c]) * _spec_bits(s)
        if any((need[g] + 7) // 8 != intra_sizes[g] for g in (0, 1)) or (need[2] + 7) // 8 > h[6]:
            raise RafError("animation keyframe masks don't match")
        p = mask_at + (nch * nintra + 7) // 8
        streams = []
        for g in range(3):
            n = intra_sizes[g] if g < 2 else (need[2] + 7) // 8
            streams.append(_Bits(data[p : p + n]))
            p += n
        for c, (kind, j, s) in enumerate(channels):
            b = streams[("rotation", "translation", "scale").index(kind)]
            for f in masks[c]:
                keys[kind][str(j)].append([start + 1 + f] + _key(b, s, kind == "rotation"))
    for kind in keys:
        for j in keys[kind]:
            keys[kind][j] = [[k[0]] + [round(x, 5) for x in k[1:]] for k in sorted(keys[kind][j], key=lambda k: k[0])]
    return {"duration": duration, "fps": freq, "frames": nframes, **keys}


# textures (.gtf)

def _swizzle_bits(w: int, h: int) -> tuple:
    """Each x's and each y's part of a swizzled texel index (OR them together)."""
    lw, lh = max(0, (w - 1).bit_length()), max(0, (h - 1).bit_length())
    xs, ys = [0] * w, [0] * h
    shift = 0
    for i in range(max(lw, lh)):
        if i < lw:
            for x in range(w):
                xs[x] |= ((x >> i) & 1) << shift
            shift += 1
        if i < lh:
            for y in range(h):
                ys[y] |= ((y >> i) & 1) << shift
            shift += 1
    return xs, ys


def _texture(data: bytes) -> tuple:
    """(meta, payload): DXT blocks with their mipmap levels, or RGBA8; rows tightly packed."""
    _ver, _size, _num = struct.unpack(">III", data[:12])
    _tid, off, tsize = struct.unpack(">III", data[12:24])
    fmt, mips, _dim, cube, _remap, w, h, _depth, _loc, _pad, pitch, _o = struct.unpack(">BBBBIHHHBBII", data[24:48])
    if cube:
        raise RafError("cube map texture")
    base = fmt & ~0x60
    linear = bool(fmt & 0x20)
    tex = data[off : off + tsize]
    if base in (0x86, 0x87, 0x88):
        block = 8 if base == 0x86 else 16
        levels = []
        p = 0
        lw, lh = w, h
        for lvl in range(max(1, mips)):
            bw, bh = max(1, (lw + 3) // 4), max(1, (lh + 3) // 4)
            row = pitch if (linear and pitch and lvl == 0) else bw * block
            if p + row * bh > len(tex):
                break
            levels.append(b"".join(tex[p + y * row : p + y * row + bw * block] for y in range(bh)))
            p += row * bh
            if lw == 1 and lh == 1:
                break
            lw, lh = max(1, lw // 2), max(1, lh // 2)
        return {"format": {0x86: "dxt1", 0x87: "dxt3", 0x88: "dxt5"}[base], "width": w, "height": h, "levels": len(levels)}, b"".join(levels)
    if base == 0x85:  # A8R8G8B8
        if linear:
            row = pitch or w * 4
            at = lambda x, y: y * row + 4 * x
        else:
            # Swizzled (the RSX's Z-order): a texel's offset interleaves the bits of x and y, x first,
            # for as many bits as both have; the larger side's are then on top. (PixelJunk Shooter 2)
            xs, ys = _swizzle_bits(w, h)
            at = lambda x, y: 4 * (xs[x] | ys[y])
        px = bytearray(w * h * 4)
        for y in range(h):
            o = 4 * w * y
            for x in range(w):
                i = at(x, y)
                a, rr, g, b = tex[i : i + 4]
                px[o : o + 4] = bytes((rr, g, b, a))
                o += 4
        return {"format": "rgba", "width": w, "height": h, "levels": 1}, bytes(px)
    raise RafError(f"unsupported texture format {fmt:#x}")


# the scene

def export(raf: bytes) -> tuple:
    """(scene dict, [texture payload bytes], script bytes) for a decompressed RAF ("RAFO")."""
    if raf[:4] != b"RAFO":
        raise RafError("not a RAF scene")
    tree = parse(raf, compressed=False)  # the same element tree as a .p3t
    files = {a.get("id", ""): a["src"] for _, n, a in tree if n == "file" and isinstance(a.get("src"), FileRef)}
    file_list = [a for _, n, a in tree if n == "file"]

    def fdata(a: dict):
        if "fileindex" in a:
            return file_list[a["fileindex"]]["src"].read()
        if "fileref" in a:
            return files[a["fileref"]].read()
        raise RafError("missing file reference")

    # Textures, by their element id: colour (type 0), normal maps (1: object space, 3: tangent space)
    # and specular maps (2).
    textures, payloads, tex_index, tex_type = [], [], {}, {}
    for _, n, a in tree:
        if n == "texture" and a.get("type", 0) in (0, 1, 2, 3):
            meta, payload = _texture(fdata(a))
            tex_index[a.get("id", "")] = len(textures)
            tex_type[a.get("id", "")] = a.get("type", 0)
            textures.append({"id": a.get("id", ""), **meta})
            payloads.append(payload)

    # Materials: their effect and their first colour, normal and specular map.
    materials = {}
    cur = None
    for _, n, a in tree:
        if n == "material":
            cur = {"effect": a.get("effect", "pure_texture"), "texture": None, "normalMap": None, "normalSpace": None, "specularMap": None}
            materials[a.get("id", "")] = cur
        elif n == "_texture" and cur is not None:
            ref = a.get("texref", "")
            kind = tex_type.get(ref)
            slot = {0: "texture", 1: "normalMap", 3: "normalMap", 2: "specularMap"}.get(kind)
            if slot and cur[slot] is None:
                cur[slot] = tex_index[ref]
                if slot == "normalMap":
                    cur["normalSpace"] = "object" if kind == 1 else "tangent"

    models, model_index = [], {}
    cur = None
    for _, n, a in tree:
        if n == "model":
            cur = {"id": a.get("id", "")}
            model_index[cur["id"]] = len(models)
            models.append(cur)
        elif cur is not None and n in ("geometry", "inv-bind", "skeleton", "animation"):
            blob = fdata(a)
            if n == "geometry":
                cur["geometry"] = _geometry(blob)
            elif n == "inv-bind":
                cur["invBind"] = [round(x, 6) for x in struct.unpack(">%df" % (len(blob) // 4), blob)]
            elif n == "skeleton":
                cur["skeleton"] = _skeleton(blob)
            else:
                # A model can have several (the script blends them by slot, in this order).
                cur.setdefault("animations", []).append({"id": a.get("id", ""), "start": a.get("start", 0.0), "end": a.get("end", 0.0), **_animation(blob)})

    actors = []
    for _, n, a in tree:
        if n != "actor":
            continue
        name = a.get("id", "")
        model = model_index.get(a.get("model", ""))
        mat = materials.get(a.get("material", ""))
        actors.append(
            {
                "id": name,
                "model": model,
                "texture": mat["texture"] if mat else None,
                # Effects are named for what they do: "pure_texture…" is unlit; "…depth_0" draws
                # without depth testing, in scene order (backgrounds, overlays).
                "lit": bool(mat and not mat["effect"].startswith("pure_texture")),
                "depth": not (mat and "depth_0" in mat["effect"]),
                "edgeLit": bool(mat and "edge_lit" in mat["effect"]),  # lit around its silhouette too (rim light)
                **({"blend": "add"} if mat and mat["effect"].endswith("_add") else {}),  # added to what's behind (glows, fire)
                **({k: mat[k] for k in ("normalMap", "normalSpace", "specularMap") if mat[k] is not None} if mat else {}),
                "position": a.get("position", [0, 0, 0]),
                "rotation": a.get("rotation", [0, 0, 0]),
                "scale": a.get("scale", [1, 1, 1]),
                "color": a.get("color", [1, 1, 1, 1]),
                "uvScale": a.get("uv_scale", [1, 1]),
                "uvOffset": a.get("uv_offset", [0, 0]),
                # Per animation slot (the script blends the slots by weight).
                "animSpeeds": a.get("anim_speed") or [1],
                "animTimes": a.get("anim_time") or [0],
                "animWeights": a.get("anim_weight") or [1],
            }
        )
    lights = [
        {"id": a.get("id", ""), "type": a.get("type", 0), "color": a.get("color", [1, 1, 1]), "position": a.get("position", [0, 0, 0]), "direction": a.get("direction", [0, 0, -1]), "attenuation": a.get("attenuation", [1, 0, 0])}
        for _, n, a in tree
        if n == "light"
    ]
    cam = next((a for _, n, a in tree if n == "camera"), {})
    camera = {
        "id": cam.get("id", ""),
        "yfov": cam.get("yfov", 0.6),
        "near": cam.get("znear", 0.1),
        "far": cam.get("zfar", 1000.0),
        "position": cam.get("position", [0, 0, 10]),
        "direction": cam.get("direction", [0, 0, -1]),
        "up": cam.get("up", [0, 1, 0]),
    }
    if cam.get("type") == 1:  # orthographic (no perspective): ymag is the view's height (Airi Ekittie's flipbook)
        camera["ymag"] = cam.get("ymag", 1.0)
    script = next((a for _, n, a in tree if n == "script"), None)
    script_bytes = fdata(script) if script else b""
    scene = {"camera": camera, "actors": actors, "models": models, "textures": textures, "lights": lights}
    return scene, payloads, script_bytes

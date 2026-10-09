"""
Reads the PS3 theme out of a PS3 package (.pkg), so it installs like a .p3t.

A .pkg is a list of files, encrypted as a whole with a counter-mode keystream:
retail packages use AES-128 with the PS3 package key (the public one RPCS3 and
other open-source tools install packages with); debug packages use SHA-1 of the
header digest. Only the item table and the theme file itself are decrypted.

Store themes usually carry their .p3t as a licence-locked .p3t.edat, which needs
the buyer's licence (a .rap); edat.py unlocks it with one.
"""

import base64
import hashlib
import struct

PS3_PKG_KEY = bytes.fromhex("2E7B71D7C9C9A14EA3221F188828B8F8")


class PkgError(Exception):
    pass


# AES-128 (encryption only, for the keystream)
# The Steam machine's Python has no crypto library, so a plain-Python fallback is kept.

def _aes_tables():
    sbox = [0] * 256
    p = q = 1
    for _ in range(255):  # the standard S-box, from the multiplicative inverse in GF(2^8)
        p ^= (p << 1) ^ (0x1B if p & 0x80 else 0)
        p &= 0xFF
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4))
        sbox[p] = (x ^ 0x63) & 0xFF
    sbox[0] = 0x63
    xt = lambda a: ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1
    t0 = [(xt(s) << 24) | (s << 16) | (s << 8) | (xt(s) ^ s) for s in sbox]
    rot = lambda t, n: [((v >> n) | (v << (32 - n))) & 0xFFFFFFFF for v in t]
    return sbox, t0, rot(t0, 8), rot(t0, 16), rot(t0, 24)


_SBOX, _T0, _T1, _T2, _T3 = _aes_tables()


def _expand(key: bytes) -> list:
    w = list(struct.unpack(">4I", key))
    rcon = 1
    for i in range(4, 44):
        t = w[i - 1]
        if i % 4 == 0:
            t = ((t << 8) | (t >> 24)) & 0xFFFFFFFF
            t = (_SBOX[t >> 24] << 24) | (_SBOX[(t >> 16) & 0xFF] << 16) | (_SBOX[(t >> 8) & 0xFF] << 8) | _SBOX[t & 0xFF]
            t ^= rcon << 24
            rcon = ((rcon << 1) ^ 0x1B) & 0xFF if rcon & 0x80 else rcon << 1
        w.append(w[i - 4] ^ t)
    return w


def _encrypt_block(w: list, block: int) -> int:
    s0, s1, s2, s3 = (block >> 96) ^ w[0], ((block >> 64) & 0xFFFFFFFF) ^ w[1], ((block >> 32) & 0xFFFFFFFF) ^ w[2], (block & 0xFFFFFFFF) ^ w[3]
    T0, T1, T2, T3, S = _T0, _T1, _T2, _T3, _SBOX
    for r in range(1, 10):
        k = 4 * r
        s0, s1, s2, s3 = (
            T0[s0 >> 24] ^ T1[(s1 >> 16) & 255] ^ T2[(s2 >> 8) & 255] ^ T3[s3 & 255] ^ w[k],
            T0[s1 >> 24] ^ T1[(s2 >> 16) & 255] ^ T2[(s3 >> 8) & 255] ^ T3[s0 & 255] ^ w[k + 1],
            T0[s2 >> 24] ^ T1[(s3 >> 16) & 255] ^ T2[(s0 >> 8) & 255] ^ T3[s1 & 255] ^ w[k + 2],
            T0[s3 >> 24] ^ T1[(s0 >> 16) & 255] ^ T2[(s1 >> 8) & 255] ^ T3[s2 & 255] ^ w[k + 3],
        )
    out = 0
    for a, b, c, d, k in ((s0, s1, s2, s3, w[40]), (s1, s2, s3, s0, w[41]), (s2, s3, s0, s1, w[42]), (s3, s0, s1, s2, w[43])):
        out = (out << 32) | (((S[a >> 24] << 24) | (S[(b >> 16) & 255] << 16) | (S[(c >> 8) & 255] << 8) | S[d & 255]) ^ k)
    return out


def _aes_ecb(key: bytes):
    """Encrypts whole blocks with AES-128: the system's crypto library if there is one, else plain Python."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        enc = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
        return enc.update
    except Exception:
        w = _expand(key)
        return lambda data: b"".join(_encrypt_block(w, int.from_bytes(data[i : i + 16], "big")).to_bytes(16, "big") for i in range(0, len(data), 16))


# the package

_CHUNK = 1 << 20  # decrypted at a time, when reporting progress


class _Package:
    def __init__(self, data: bytes):
        if data[:4] != b"\x7fPKG":
            raise PkgError("not a PS3 package")
        rev, kind = struct.unpack(">HH", data[4:8])
        if kind != 1:
            raise PkgError("not a PS3 package (PSP or other)")
        self.items, _total, self.data_off, self.data_size = struct.unpack(">IQQQ", data[0x14:0x30])
        self.data = data
        self.content_id = data[0x30:0x60].split(b"\0")[0].decode("ascii", "replace")
        if rev & 0x8000:  # retail: AES-128-CTR, counter from the header
            iv = int.from_bytes(data[0x70:0x80], "big")
            aes = _aes_ecb(PS3_PKG_KEY)
            self.keystream = lambda first, n: aes(b"".join(((iv + first + i) & ((1 << 128) - 1)).to_bytes(16, "big") for i in range(n)))
        else:  # debug: SHA-1 over the header digest and the block number
            qa = data[0x60:0x70]
            seed = qa[:8] * 2 + qa[8:16] * 2 + bytes(24)
            self.keystream = lambda first, n: b"".join(hashlib.sha1(seed + (first + i).to_bytes(8, "big")).digest()[:16] for i in range(n))

    def read(self, off: int, size: int, progress=None) -> bytes:
        """`size` decrypted bytes at `off` in the data area; progress(share done), if given, is told as it goes."""
        if progress and size > _CHUNK:
            parts = []
            for at in range(0, size, _CHUNK):
                progress(at / size)
                parts.append(self.read(off + at, min(_CHUNK, size - at)))
            return b"".join(parts)
        if size <= 0:
            return b""
        if off < 0 or off + size > self.data_size:
            raise PkgError("damaged package")
        first, skip = divmod(off, 16)
        n = (skip + size + 15) // 16
        raw = self.data[self.data_off + first * 16 : self.data_off + (first + n) * 16]
        ks = self.keystream(first, n)
        plain = (int.from_bytes(raw, "big") ^ int.from_bytes(ks[: len(raw)], "big")).to_bytes(len(raw), "big")
        return plain[skip : skip + size]

    def files(self):
        """(name, offset, size) of each file in the package."""
        table = self.read(0, self.items * 32)
        for i in range(self.items):
            name_off, name_size, off, size, flags, _ = struct.unpack(">IIQQII", table[i * 32 : i * 32 + 32])
            if flags & 0xFF == 4:  # a folder
                continue
            yield self.read(name_off, name_size).decode("utf-8", "replace"), off, size


def load(path: str) -> _Package:
    """A package, read once for icon() and theme(); PkgError if it isn't a PS3 one."""
    with open(path, "rb") as f:
        return _Package(f.read())


def icon(pkg: _Package):
    """The package's icon (ICON0.PNG), as a data URI, if it has one."""
    try:
        for name, off, size in pkg.files():
            if name.rsplit("/", 1)[-1].upper() == "ICON0.PNG" and size < 1 << 20:
                data = pkg.read(off, size)
                if data[:8] == b"\x89PNG\r\n\x1a\n":
                    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
    except Exception:
        pass
    return None


def theme(pkg: _Package, licences=None, progress=None):
    """
    (file name, .p3t bytes) of the PS3 theme in a package; PkgError says why if there isn't a usable one.
    A licence-locked theme is unlocked with the first of licences(content ID) (.rap contents) that fits;
    edat.NeedsLicence if none does. progress(share done), if given, is told as it goes.
    """
    report = progress or (lambda f: None)
    locked = None
    for name, off, size in pkg.files():
        low = name.lower()
        if low.endswith(".p3t"):
            data = pkg.read(off, size, report)
            if data[:4] == b"P3TF":
                return name.rsplit("/", 1)[-1], data
        elif low.endswith(".edat") and ".p3t" in low and locked is None:
            locked = name, off, size
    if locked:
        name, off, size = locked
        # Unlocking takes as long as reading it out did: each gets half.
        data = pkg.read(off, size, lambda f: report(f / 2))
        return name.rsplit("/", 1)[-1][: -len(".edat")], unlock(data, licences, lambda f: report(0.5 + f / 2))
    raise PkgError("There's no PS3 theme in this package")


def unlock(data: bytes, licences=None, progress=None) -> bytes:
    """The .p3t in a .p3t.edat, decrypted with the licence that fits (see theme())."""
    import edat

    try:
        plain = edat.decrypt(data, progress=progress)  # free (SDAT) and debug ones need no licence
    except edat.NeedsLicence as e:
        for rap in licences(e.content_id) if licences else ():
            klic = edat.rap_to_klicensee(rap)
            if edat.decrypt(data, klic, blocks=1)[:4] == b"P3TF":  # a wrong licence gives garbage
                plain = edat.decrypt(data, klic, progress=progress)
                break
        else:
            raise
    if plain[:4] != b"P3TF":
        raise PkgError("Can't install: couldn't unlock this theme")
    return plain

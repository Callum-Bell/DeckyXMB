"""
Decrypts a licence-locked PS3 file (.edat), such as the .p3t.edat in a store theme's
package, with the buyer's licence for it (a .rap, named after the content ID), or none for free content.

The .rap is turned into the content's licence key the way RPCS3 does, and each
block of the file is decrypted with a key derived from it (AES-128-CBC). Hashes
aren't checked; the caller checks the result is what it expected instead (a
wrong licence gives garbage). Compressed EDATs aren't supported.
"""

import struct

from pkg import _SBOX, _aes_ecb, _expand

RAP_KEY = bytes.fromhex("869F7745C13FD890CCF29188E3CC3EDF")
RAP_PBOX = bytes.fromhex("0C030604010B0F08020700050A0E0D09")
RAP_E1 = bytes.fromhex("A93E1FD67C55A329B75FDDA62A95C7A5")
RAP_E2 = bytes.fromhex("67D45DA3296D006A4E7C537BF5538C74")
EDAT_KEYS = (bytes.fromhex("BE959CA8308DEFA2E5E180C63712A9AE"), bytes.fromhex("4CA9C14B01C95309969BEC68AA0BC081"))  # NPD version < 4, 4
SDAT_KEY = bytes.fromhex("0D655EF8E674A98AB8505CFA7D012933")
KLIC_FREE = bytes.fromhex("72F990788F9CFF745725F08E4C128387")  # the licence key of free content (no .rap)
LICENCE_FREE = 3  # the header's licence type for free content (1, 2: network, local)

FLAG_COMPRESSED = 0x01
FLAG_PLAIN = 0x02  # blocks aren't encrypted
FLAG_KEY_ENCRYPTED = 0x08
FLAG_INTERLEAVED = 0x20  # each block's metadata sits just before it
FLAG_SDAT = 0x01000000  # no licence needed
FLAG_DEBUG = 0x80000000  # not encrypted


class EdatError(Exception):
    pass


class NeedsLicence(EdatError):
    def __init__(self, content_id: str):
        super().__init__(f"Needs its licence: {content_id}.rap")
        self.content_id = content_id


# AES-128 decryption (the system's crypto library if there is one, else plain Python)

def _dec_tables():
    inv = [0] * 256
    for i, s in enumerate(_SBOX):
        inv[s] = i

    def mul(a, b):
        r = 0
        while b:
            if b & 1:
                r ^= a
            a = ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1
            b >>= 1
        return r

    t0 = [(mul(s, 14) << 24) | (mul(s, 9) << 16) | (mul(s, 13) << 8) | mul(s, 11) for s in inv]
    rot = lambda t, n: [((v >> n) | (v << (32 - n))) & 0xFFFFFFFF for v in t]
    return inv, t0, rot(t0, 8), rot(t0, 16), rot(t0, 24)


_ISBOX, _D0, _D1, _D2, _D3 = _dec_tables()


def _expand_dec(key: bytes) -> list:
    """The round keys in reverse, the middle ones through InvMixColumns (the equivalent inverse cipher)."""
    w = _expand(key)
    S, D0, D1, D2, D3 = _SBOX, _D0, _D1, _D2, _D3
    out = []
    for r in range(11):
        words = w[4 * (10 - r) : 4 * (10 - r) + 4]
        if 0 < r < 10:
            words = [D0[S[x >> 24]] ^ D1[S[(x >> 16) & 255]] ^ D2[S[(x >> 8) & 255]] ^ D3[S[x & 255]] for x in words]
        out += words
    return out


def _decrypt_block(w: list, block: int) -> int:
    s0, s1, s2, s3 = (block >> 96) ^ w[0], ((block >> 64) & 0xFFFFFFFF) ^ w[1], ((block >> 32) & 0xFFFFFFFF) ^ w[2], (block & 0xFFFFFFFF) ^ w[3]
    D0, D1, D2, D3, S = _D0, _D1, _D2, _D3, _ISBOX
    for r in range(1, 10):
        k = 4 * r
        s0, s1, s2, s3 = (
            D0[s0 >> 24] ^ D1[(s3 >> 16) & 255] ^ D2[(s2 >> 8) & 255] ^ D3[s1 & 255] ^ w[k],
            D0[s1 >> 24] ^ D1[(s0 >> 16) & 255] ^ D2[(s3 >> 8) & 255] ^ D3[s2 & 255] ^ w[k + 1],
            D0[s2 >> 24] ^ D1[(s1 >> 16) & 255] ^ D2[(s0 >> 8) & 255] ^ D3[s3 & 255] ^ w[k + 2],
            D0[s3 >> 24] ^ D1[(s2 >> 16) & 255] ^ D2[(s1 >> 8) & 255] ^ D3[s0 & 255] ^ w[k + 3],
        )
    out = 0
    for a, b, c, d, k in ((s0, s3, s2, s1, w[40]), (s1, s0, s3, s2, w[41]), (s2, s1, s0, s3, w[42]), (s3, s2, s1, s0, w[43])):
        out = (out << 32) | (((S[a >> 24] << 24) | (S[(b >> 16) & 255] << 16) | (S[(c >> 8) & 255] << 8) | S[d & 255]) ^ k)
    return out


def _aes_ecb_decrypt(key: bytes):
    """Decrypts whole blocks with AES-128."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        return dec.update
    except ImportError:
        w = _expand_dec(key)
        return lambda data: b"".join(_decrypt_block(w, int.from_bytes(data[i : i + 16], "big")).to_bytes(16, "big") for i in range(0, len(data), 16))


def _aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        return dec.update(data) + dec.finalize()
    except ImportError:
        pass
    w = _expand_dec(key)
    prev = int.from_bytes(iv, "big")
    out = []
    for i in range(0, len(data), 16):
        c = int.from_bytes(data[i : i + 16], "big")
        out.append((_decrypt_block(w, c) ^ prev).to_bytes(16, "big"))
        prev = c
    return b"".join(out)


# licences

def rap_to_klicensee(rap: bytes) -> bytes:
    """The content's licence key from its .rap (16 bytes)."""
    if len(rap) != 16:
        raise EdatError("Not a PS3 licence (.rap)")
    key = bytearray(_aes_cbc_decrypt(RAP_KEY, bytes(16), rap))
    for _ in range(5):
        for p in RAP_PBOX:
            key[p] ^= RAP_E1[p]
        for i in range(15, 0, -1):
            key[RAP_PBOX[i]] ^= key[RAP_PBOX[i - 1]]
        o = 0
        for p in RAP_PBOX:
            kc = (key[p] - o) & 0xFF
            ec2 = RAP_E2[p]
            if o != 1 or kc != 0xFF:
                o = 1 if kc < ec2 else 0
            key[p] = (kc - ec2) & 0xFF
    return bytes(key)


# the file

def content_id(data: bytes) -> str:
    """The content ID in an EDAT's header (its .rap is named after it)."""
    if data[:4] != b"NPD\0":
        raise EdatError("Not a PS3 licensed file (.edat)")
    return data[0x10:0x40].split(b"\0")[0].decode("ascii", "replace")


def decrypt(data: bytes, klicensee: bytes = None, blocks: int = None, progress=None) -> bytes:
    """
    The decrypted contents of an EDAT (or just its first `blocks` blocks).
    `klicensee` is from its .rap; free content, SDATs and debug EDATs don't need one.
    progress(share done), if given, is told as it goes.
    """
    cid = content_id(data)
    version, licence = struct.unpack(">II", data[4:12])
    digest, dev_hash = data[0x40:0x50], data[0x60:0x70]
    flags, block_size, file_size = struct.unpack(">IIQ", data[0x80:0x90])
    if flags & FLAG_COMPRESSED:
        raise EdatError("Can't install: compressed licensed files aren't supported")
    if flags & FLAG_SDAT:
        key = bytes(a ^ b for a, b in zip(dev_hash, SDAT_KEY))
    elif flags & FLAG_DEBUG:
        key = bytes(16)
    elif klicensee is None and licence == LICENCE_FREE:
        key = KLIC_FREE
    elif klicensee is None:
        raise NeedsLicence(cid)
    else:
        key = klicensee
    if not block_size:
        raise EdatError("damaged licensed file")

    total = (file_size + block_size - 1) // block_size
    meta = 0x20 if flags & FLAG_INTERLEAVED else 0x10
    iv = bytes(16) if version <= 1 else digest
    base = bytes(12) if version <= 1 else dev_hash[:12]
    block_key = _aes_ecb(key)
    unwrap = _aes_ecb_decrypt(EDAT_KEYS[1 if version == 4 else 0]) if flags & FLAG_KEY_ENCRYPTED else None
    out = []
    count = total if blocks is None else min(blocks, total)
    for i in range(count):
        if progress and i % 16 == 0:
            progress(i / count)
        if flags & FLAG_INTERLEAVED:
            off = 0x100 + i * (meta + block_size) + meta
        else:
            off = 0x100 + i * block_size + total * meta
        length = block_size if i < total - 1 or file_size % block_size == 0 else file_size % block_size
        enc = data[off : off + ((length + 15) & ~15)]
        if len(enc) & 15 or len(enc) < length:
            raise EdatError("damaged licensed file")
        if flags & (FLAG_DEBUG | FLAG_PLAIN):
            plain = enc
        else:
            k = block_key(base + struct.pack(">I", i))
            if unwrap:
                k = unwrap(k)
            plain = _aes_cbc_decrypt(k, iv, enc)
        out.append(plain[:length])
    return b"".join(out)


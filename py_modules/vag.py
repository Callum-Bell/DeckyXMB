"""
Turns a PS3 theme's sound effects (VAG: Sony's ADPCM) into WAV files that Steam can play.

A VAG file is a 48-byte header (big-endian: "VAGp", version, size, sample rate) and then mono
16-byte frames. Each frame is a predictor/shift byte, a flags byte and 28 4-bit samples.
"""

import struct

_COEFS = ((0, 0), (60, 0), (115, -52), (98, -55), (122, -60))  # each predictor's weights, in 64ths
_FLAG_END = 0x01
_FLAG_EMPTY = 0x07  # (a frame that's only padding)


class VagError(Exception):
    pass


def decode(data: bytes):
    """(sample rate, [16-bit samples]) of a VAG file."""
    if data[:4] != b"VAGp" or len(data) < 0x30:
        raise VagError("not a VAG sound")
    rate = struct.unpack(">I", data[0x10:0x14])[0] or 44100
    out = []
    s1 = s2 = 0
    for off in range(0x30, len(data) - 15, 16):
        head, flags = data[off], data[off + 1]
        if flags == _FLAG_EMPTY:
            break
        shift = head & 0x0F
        c1, c2 = _COEFS[min(head >> 4, 4)]
        for byte in data[off + 2 : off + 16]:
            for nibble in (byte & 0x0F, byte >> 4):
                s = (nibble - 16 if nibble & 8 else nibble) << 12 >> shift
                s += (s1 * c1 + s2 * c2 + 32) >> 6
                s = -32768 if s < -32768 else 32767 if s > 32767 else s
                s2, s1 = s1, s
                out.append(s)
        if flags & _FLAG_END:
            break
    return rate, out


def wav(rate: int, samples, gain: float = 1.0) -> bytes:
    """A mono 16-bit WAV of the samples, made louder by `gain`."""
    if gain != 1.0:
        samples = [max(-32768, min(32767, round(s * gain))) for s in samples]
    pcm = struct.pack("<%dh" % len(samples), *samples)
    return (
        struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(pcm), b"WAVE", b"fmt ", 16, 1, 1, rate, rate * 2, 2, 16, b"data", len(pcm))
        + pcm
    )


def peak(samples) -> int:
    return max((abs(s) for s in samples), default=0)

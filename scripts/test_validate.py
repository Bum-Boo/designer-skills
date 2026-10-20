"""Regression checks for private-path detection in PNG text chunks."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

from validate import png_text, validate


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


class MetadataTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='skill-metadata-check-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.image = self.root / 'preview.png'
        skill = self.root / 'skills' / 'sample'
        skill.mkdir(parents=True)
        (skill/'SKILL.md').write_text('---\nname: sample\ndescription: Example.\nlicense: MIT\n---\nExample.\n', encoding='utf-8')
        (skill/'LICENSE').write_text('MIT', encoding='utf-8')
        (self.root/'catalog.json').write_text(json.dumps({'version': 'test', 'skills': [{'name': 'sample'}]}), encoding='utf-8')
        names = ('README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md')
        text = 'sample test\n' + '\n'.join(f'[language]({name})' for name in names)
        for name in names:
            (self.root/name).write_text(text, encoding='utf-8')

    def write_png(self, kind, payload):
        # These minimal chunks exercise the metadata reader, not an image decoder.
        self.image.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(kind, payload) + chunk(b'IEND', b''))

    def test_clean_metadata_passes(self):
        self.write_png(b'tEXt', b'Software\0Blender')
        self.assertEqual(validate(self.root)[0], [])

    def test_local_path_is_caught_in_standard_and_compressed_text(self):
        private_path = '/' + 'Users/' + 'example/project.blend'
        for kind, payload in ((b'tEXt', b'File\0' + private_path.encode()),
                              (b'zTXt', b'File\0\0' + zlib.compress(private_path.encode()))):
            with self.subTest(kind=kind):
                self.write_png(kind, payload)
                errors = validate(self.root)[0]
                self.assertTrue(any('private path or credential in PNG metadata' in item for item in errors))

    def test_international_text_is_decoded_and_checked(self):
        private_path = '/' + 'home/' + 'example/장면.blend'
        for compressed in (False, True):
            value = private_path.encode('utf-8')
            payload = b'File\0' + bytes([int(compressed), 0]) + b'\0\0' + (zlib.compress(value) if compressed else value)
            self.write_png(b'iTXt', payload)
            self.assertIn(private_path, png_text(self.image))
            self.assertTrue(validate(self.root)[0])

    def test_corrupted_chunk_is_rejected(self):
        self.write_png(b'tEXt', b'File\0clean')
        data = bytearray(self.image.read_bytes())
        data[17] ^= 1
        self.image.write_bytes(data)
        with self.assertRaises(ValueError):
            png_text(self.image)
        self.assertTrue(any('Invalid PNG chunk checksum' in item for item in validate(self.root)[0]))


if __name__ == '__main__':
    unittest.main()

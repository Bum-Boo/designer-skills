"""Validate package layout, local Markdown links and public-file hygiene; stdlib only."""
import ast
import json
from pathlib import Path
import re
import struct
import sys
import zlib
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


def png_text(path):
    """Read standard PNG text chunks without loading or altering image pixels."""
    data = path.read_bytes()
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Invalid PNG signature')
    offset, values = 8, []
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError('Truncated PNG chunk')
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        if offset + 12 + length > len(data):
            raise ValueError('Truncated PNG payload')
        payload = data[offset+8:offset+8+length]
        checksum = struct.unpack('>I', data[offset+8+length:offset+12+length])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != checksum:
            raise ValueError('Invalid PNG chunk checksum')
        if kind == b'tEXt':
            key, value = payload.split(b'\0', 1)
            values.append(key.decode('latin-1') + ': ' + value.decode('latin-1'))
        elif kind == b'zTXt':
            key, rest = payload.split(b'\0', 1)
            if not rest or rest[0] != 0:
                raise ValueError('Invalid PNG text compression')
            values.append(key.decode('latin-1') + ': ' + zlib.decompress(rest[1:]).decode('latin-1'))
        elif kind == b'iTXt':
            key, rest = payload.split(b'\0', 1)
            flag, method = rest[0], rest[1]
            _, translated = rest[2:].split(b'\0', 1)
            _, value = translated.split(b'\0', 1)
            if flag not in (0, 1) or method != 0:
                raise ValueError('Invalid PNG international text')
            if flag:
                value = zlib.decompress(value)
            values.append(key.decode('latin-1') + ': ' + value.decode('utf-8'))
        offset += 12 + length
        if kind == b'IEND':
            break
    return '\n'.join(values)


def validate(root=ROOT):
    errors = []
    catalog = json.loads((root / 'catalog.json').read_text(encoding='utf-8'))
    declared = [row['name'] for row in catalog['skills']]
    found = sorted(path.parent.name for path in (root / 'skills').glob('*/SKILL.md'))
    if sorted(declared) != found or len(declared) != len(set(declared)):
        errors.append('Catalog and skill directories differ or contain duplicates')
    for name in found:
        folder = root / 'skills' / name
        content = (folder / 'SKILL.md').read_text(encoding='utf-8')
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name) or len(name) > 64:
            errors.append(f'{name}: invalid skill name')
        parts = content.split('---', 2)
        if len(parts) != 3 or parts[0].strip():
            errors.append(f'{name}: missing frontmatter')
            continue
        front = parts[1]
        for key in ('name', 'description', 'license'):
            match = re.search(rf'^{key}:\s*(.+)$', front, re.M)
            if not match:
                errors.append(f'{name}: missing {key}')
            elif key == 'name' and match.group(1).strip() != name:
                errors.append(f'{name}: name differs from directory')
            elif key == 'description' and len(match.group(1)) > 1024:
                errors.append(f'{name}: description too long')
        if not (folder / 'LICENSE').is_file():
            errors.append(f'{name}: missing bundled license')
    readmes = ('README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md')
    blocks = []
    for name in readmes:
        path = root / name
        if not path.is_file():
            errors.append(f'Missing {name}')
            continue
        content = path.read_text(encoding='utf-8')
        blocks.append(re.findall(r'```bash\n(.*?)```', content, re.S))
        for other in readmes:
            if other != name and f']({other})' not in content:
                errors.append(f'{name}: missing language link to {other}')
        for skill in declared:
            if skill not in content:
                errors.append(f'{name}: missing catalog entry {skill}')
        if catalog['version'] not in content:
            errors.append(f'{name}: version differs from catalog')
    if blocks and any(block != blocks[0] for block in blocks[1:]):
        errors.append('README command blocks differ between translations')
    # Components are assembled from reviewed text/code. Scan tracked candidates,
    # without reading .git, runtime outputs or the user's surrounding workspace.
    forbidden = [r'[A-Za-z]:[/\\]Users[/\\]', r'/home/[A-Za-z0-9_]', r'/Users/[A-Za-z0-9_]',
                 r'gh[pousr]_[A-Za-z0-9]{20,}', r'\bsk-[A-Za-z0-9]{20,}']
    files = [p for p in root.rglob('*') if p.is_file()
             and not any(x in {'.git', '__pycache__', 'node_modules', 'output'} for x in p.relative_to(root).parts)]
    for path in files:
        if path.suffix == '.png':
            try:
                metadata = png_text(path)
                if any(re.search(pattern, metadata) for pattern in forbidden):
                    errors.append(f'{path.relative_to(root)}: private path or credential in PNG metadata')
            except (ValueError, IndexError, zlib.error) as error:
                errors.append(f'{path.relative_to(root)}: invalid PNG metadata: {error}')
            continue
        if path.suffix not in {'.md', '.py', '.json', '.yaml', '.yml', '.txt'}:
            continue
        relative = path.relative_to(root).as_posix()
        content = path.read_text(encoding='utf-8')
        if path.suffix == '.py':
            try:
                ast.parse(content, filename=relative)
            except SyntaxError as error:
                errors.append(f'{relative}: {error}')
        if any(re.search(pattern, content) for pattern in forbidden):
            errors.append(f'{relative}: possible private path or credential')
        if path.suffix == '.md':
            # Ignore fenced examples and external URLs; validate actual local links.
            prose = re.sub(r'```.*?```', '', content, flags=re.S)
            for target in re.findall(r'\]\(([^)]+)\)', prose):
                target = target.strip('<>').split('#', 1)[0]
                if not target or re.match(r'[a-z][a-z0-9+.-]*:', target):
                    continue
                resolved = (path.parent / unquote(target)).resolve()
                if not resolved.is_relative_to(root.resolve()) or not resolved.exists():
                    errors.append(f'{relative}: broken or escaping link {target}')
    return errors, len(found), len(files)


if __name__ == '__main__':
    problems, skills, files = validate()
    print(json.dumps({'passed': not problems, 'skills': skills, 'files': files, 'errors': problems}, indent=2))
    sys.exit(1 if problems else 0)

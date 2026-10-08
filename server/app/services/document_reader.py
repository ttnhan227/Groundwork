"""Passive, bounded document extraction. No Office automation or macros."""
from pathlib import Path
import re
import zipfile
from xml.etree import ElementTree as ET

OFFICE_EXTENSIONS = {'.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub'}
MAX_XML = 8 * 1024 * 1024
MAX_TEXT = 500_000
MAX_ARCHIVE_ENTRIES = 10_000


def read_document(path: Path) -> str:
    parts, consumed = [], 0
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist()) > MAX_ARCHIVE_ENTRIES:
            raise ValueError("Document contains too many archive entries.")
        names = set(archive.namelist())
        def xml(name):
            nonlocal consumed
            entry = archive.getinfo(name)
            consumed += entry.file_size
            if entry.file_size > MAX_XML or consumed > 24 * 1024 * 1024:
                raise ValueError('Document exceeds the extraction limit.')
            data = archive.read(entry)
            declarations = data.replace(b'\x00', b'').upper()
            if b'<!DOCTYPE' in declarations or b'<!ENTITY' in declarations:
                raise ValueError('Document contains unsupported XML declarations.')
            return ET.fromstring(data)
        def local(element):
            return element.tag.rsplit('}', 1)[-1]
        ext = path.suffix.lower()
        if ext == '.docx':
            root = xml('word/document.xml')
            parts = [''.join(n.text or '' for n in p.iter() if local(n) == 't') for p in root.iter() if local(p) == 'p']
        elif ext == '.pptx':
            slides = sorted((n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)), key=lambda n: int(re.search(r'slide(\d+)', n).group(1)))
            for number, name in enumerate(slides[:100], 1):
                parts.append(f'--- Slide {number} ---')
                parts.extend(''.join(n.text or '' for n in p.iter() if local(n) == 't') for p in xml(name).iter() if local(p) == 'p')
            if len(slides) > 100:
                parts.append('[Only the first 100 slides were extracted.]')
        elif ext == '.xlsx':
            text_size = 0
            shared = []
            if 'xl/sharedStrings.xml' in names:
                shared = [''.join(n.text or '' for n in item.iter() if local(n) == 't') for item in xml('xl/sharedStrings.xml').iter() if local(item) == 'si']
            # Resolve workbook relationships so tab names remain meaningful.
            relations = {n.attrib.get('Id'): n.attrib.get('Target', '') for n in xml('xl/_rels/workbook.xml.rels')}
            sheets = [n for n in xml('xl/workbook.xml').iter() if local(n) == 'sheet']
            for sheet in sheets[:30]:
                target = relations.get(sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'), '')
                name = target.lstrip('/') if target.startswith('/') else 'xl/' + target
                if name not in names:
                    continue
                parts.append(f"--- Sheet: {sheet.attrib.get('name', 'Unnamed')} ---")
                for row in (n for n in xml(name).iter() if local(n) == 'row'):
                    cells = []
                    for cell in row:
                        value = next((n.text or '' for n in cell if local(n) == 'v'), '')
                        if cell.attrib.get('t') == 's':
                            value = shared[int(value)] if value.isdigit() and int(value) < len(shared) else ''
                        elif cell.attrib.get('t') == 'inlineStr':
                            value = ''.join(n.text or '' for n in cell.iter() if local(n) == 't')
                        formula = next((n.text for n in cell if local(n) == 'f'), None)
                        if formula:
                            value += f' [formula: {formula}; cached result, not recalculated]'
                        cells.append(f"{cell.attrib.get('r', '?')}: {value}")
                    row_text = ' | '.join(cells)
                    parts.append(row_text)
                    text_size += len(row_text)
                    if text_size > MAX_TEXT:
                        break
                if text_size > MAX_TEXT:
                    break
        elif ext in {'.odt', '.ods', '.odp'}:
            root = xml('content.xml')
            parts = [''.join(n.itertext()) for n in root.iter() if local(n) in {'p', 'h'}]
        elif ext == '.epub':
            # Read only the ordered publication spine, without executing HTML.
            container = xml('META-INF/container.xml')
            package = next(n.attrib['full-path'] for n in container.iter() if local(n) == 'rootfile')
            root = xml(package)
            manifest = {n.attrib['id']: n.attrib.get('href', '') for n in root.iter() if local(n) == 'item'}
            base = str(Path(package).parent).replace('\\', '/')
            for item in (n for n in root.iter() if local(n) == 'itemref'):
                href = manifest.get(item.attrib.get('idref'), '')
                name = href if base == '.' else base + '/' + href
                if name in names:
                    page = xml(name)
                    parts.extend(''.join(n.itertext()) for n in page.iter() if local(n) in {'p', 'h1', 'h2', 'h3', 'li'})
        text = '\n'.join(parts)
        return text[:MAX_TEXT] + ('\n[Extraction truncated at 500,000 characters.]' if len(text) > MAX_TEXT else '')

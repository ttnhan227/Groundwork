import io
import zipfile
import pytest
from PIL import Image
import fitz
from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.workspace_service import WorkspaceService
from app.services.preview_service import PreviewService


@pytest.fixture
def files(tmp_path, monkeypatch):
    reset_db()
    monkeypatch.setattr(config, '_settings', config.Settings(database_path=tmp_path/'state.db', data_dir=tmp_path))
    root = tmp_path/'files'
    root.mkdir()
    WorkspaceService().create_workspace(WorkspaceCreate(name='Files', path=str(root)))
    yield root
    reset_db()


def test_text_pages_and_markup_are_passive(files):
    path = files/'document.html'
    path.write_text('<script>danger()</script>\n' + '\n'.join(f'Line {i}' for i in range(1, 450)), encoding='utf-8')
    first = PreviewService().preview(str(path))
    assert first['kind'] == 'text' and '<script>' in first['text']
    second = PreviewService().preview(str(path), 2)
    assert second['line_start'] == 201 and second['pages'] == 3
    with pytest.raises(ValueError):
        PreviewService().preview(str(path), 4)


def test_raster_image_converts_to_bounded_png(files):
    path = files/'image.jpg'
    Image.new('RGB', (2000, 1000), 'blue').save(path)
    before = path.read_bytes()
    result = PreviewService().preview(str(path))
    assert result['kind'] == 'image' and result['image'].startswith('data:image/png;base64,')
    assert path.read_bytes() == before


def test_pdf_page_preview(files):
    path = files/'document.pdf'
    with fitz.open() as document:
        for text in ['First page', 'Second page']:
            page = document.new_page()
            page.insert_text((40,40), text)
        document.save(path)
    result = PreviewService().preview(str(path), 2)
    assert result['kind'] == 'pdf' and result['pages'] == 2
    assert result['image'].startswith('data:image/png;base64,')


def test_docx_text_preview_without_extracting_files(files):
    path = files/'document.docx'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello document</w:t></w:r></w:p></w:body></w:document>')
    result = PreviewService().preview(str(path))
    assert result['kind'] == 'text' and result['text'] == 'Hello document'
    assert list(files.iterdir()) == [path]


def test_preview_respects_workspace_and_privacy_rules(files):
    private = files/'.env'
    private.write_text('SECRET=value')
    outside = files.parent/'outside.txt'
    outside.write_text('private')
    for path in (private, outside):
        with pytest.raises((ValueError, PermissionError)):
            PreviewService().preview(str(path))


def test_missing_binary_corrupt_and_utf16(files):
    with pytest.raises(ValueError):
        PreviewService().preview(str(files/'missing.txt'))
    path = files/'binary.txt'
    path.write_bytes(b'\0\1')
    assert PreviewService().preview(str(path))['kind'] == 'unsupported'
    path = files/'broken.pdf'
    path.write_bytes(b'not a PDF')
    assert PreviewService().preview(str(path))['kind'] == 'unsupported'
    path = files/'unicode.txt'
    path.write_bytes('Readable text'.encode('utf-16'))
    assert PreviewService().preview(str(path))['text'] == 'Readable text'

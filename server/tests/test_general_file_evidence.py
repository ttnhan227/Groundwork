import os
import zipfile
import pytest
import fitz
from PIL import Image, ImageDraw, ImageFont
from app.core import config
from app.database.local_db import reset_db, get_db
from app.models.types import WorkspaceCreate, AIQueryRequest
from app.services.workspace_service import WorkspaceService
from app.services.ai.tools import AIToolManager
from app.services.ai.context_engine import AIContextEngine
from app.services.file_parser import FileParser
from app.services.document_reader import read_document
from app.services.preview_service import PreviewService


@pytest.fixture
def files(tmp_path, monkeypatch):
    reset_db()
    monkeypatch.setattr(config, '_settings', config.Settings(database_path=tmp_path/'state.db', data_dir=tmp_path, ai_provider='local'))
    root = tmp_path/'files'
    root.mkdir()
    WorkspaceService().create_workspace(WorkspaceCreate(name='Files', path=str(root)))
    yield root
    reset_db()


def archive(path, entries):
    with zipfile.ZipFile(path, 'w') as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return path


def test_office_ai_and_preview(files):
    doc = archive(files/'contract.docx', {'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Cancellation December 12</w:t></w:r></w:p></w:body></w:document>'})
    ppt = archive(files/'meeting.pptx', {'ppt/slides/slide1.xml': '<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Launch November 25</a:t></a:r></a:p>'})
    xls = archive(files/'budget.xlsx', {'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Expenses" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/sharedStrings.xml': '<sst><si><t>Laptop</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>600*2</f><v>1200</v></c></row></sheetData></worksheet>'})
    for path, text in [(doc, 'December 12'), (ppt, 'November 25'), (xls, '1200')]:
        assert FileParser.is_supported(path)
        assert text in PreviewService().preview(str(path))['text']
        source = AIToolManager()._read_file(str(path))
        assert text in source['content'] and source['evidence_kind'] == 'text'
    assert 'cached result' in read_document(xls)
    answer = AIContextEngine().query(AIQueryRequest(question='What are the deadlines?', file_paths=[str(doc), str(ppt)]))
    assert len(answer.citations) == 2 and 'Extracted document text' in answer.citations[0].coverage


def test_binary_unknown_and_large_metadata(files):
    for path in [files/'unknown.xyz', files/'binary.txt']:
        path.write_bytes(b'\x00private binary contents')
        source = AIToolManager()._read_file(str(path))
        assert source['evidence_kind'] == 'metadata'
        assert 'private binary contents' not in source['content']
        assert 'Contents were not read' in source['content']
    path = files/'big.txt'
    with path.open('wb') as f:
        f.truncate(33 * 1024 * 1024)
    assert AIToolManager()._read_file(str(path))['evidence_kind'] == 'metadata'


def test_folder_sample_without_private_or_nested_contents(files):
    (files/'plan.txt').write_text('Launch November 25')
    (files/'.env').write_text('SECRET=NEVER_READ')
    nested = files/'nested'
    nested.mkdir()
    (nested/'private.txt').write_text('NESTED_NEVER_READ')
    answer = AIContextEngine().query(AIQueryRequest(question='Summarize this folder', file_paths=[str(files)]))
    assert any(c.evidence_kind == 'folder' for c in answer.citations)
    assert any(c.filename == 'plan.txt' for c in answer.citations)
    assert 'NEVER_READ' not in str(answer)
    assert 'nested folders' in answer.answer.lower()


def test_user_image_exclusion(files):
    Image.new('RGB', (20, 20)).save(files/'private.png')
    ws = WorkspaceService().list_workspaces()[0]
    conn = get_db().get_connection()
    conn.execute("UPDATE workspaces SET ignore_patterns='[\"*.png\"]' WHERE id=?", (ws.id,))
    conn.commit()
    assert 'error' in AIToolManager()._read_file(str(files/'private.png'))


def test_xml_entities_and_expansion_rejected(files):
    path = archive(files/'bad.docx', {'word/document.xml': '<!DOCTYPE root [<!ENTITY x "secret">]><root>&x;</root>'})
    with pytest.raises(ValueError):
        read_document(path)
    path = archive(files/'large.docx', {'word/document.xml': 'x' * (8 * 1024 * 1024 + 1)})
    with pytest.raises(ValueError):
        read_document(path)


def test_utf16_ai(files):
    path = files/'note.txt'
    path.write_bytes('Warranty November 25'.encode('utf-16'))
    assert 'November 25' in AIToolManager()._read_file(str(path))['content']


@pytest.mark.skipif(os.name != 'nt', reason='Requires Windows OCR')
def test_real_windows_ocr_and_scanned_pdf(files):
    image = Image.new('RGB', (1000, 400), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 40)
    draw.text((30, 30), 'Laptop receipt\nTotal 1200 USD\nWarranty November 25', fill='black', font=font)
    path = files/'receipt.png'
    image.save(path)
    source = AIToolManager()._read_file(str(path))
    assert source['evidence_kind'] == 'ocr' and '1200' in source['content']
    pdf = files/'scan.pdf'
    with fitz.open() as doc:
        page = doc.new_page(width=1000, height=400)
        page.insert_image(page.rect, filename=str(path))
        doc.save(pdf)
    source = AIToolManager()._read_file(str(pdf))
    assert '1200' in source['content'] and 'OCR attempted on 1' in source['coverage']


def test_document_archive_entry_limit(files):
    from app.services.document_reader import MAX_ARCHIVE_ENTRIES
    path = files / "too-many-entries.docx"
    with zipfile.ZipFile(path, "w") as z:
        for index in range(MAX_ARCHIVE_ENTRIES + 1):
            z.writestr(f"part-{index}", "")
    with pytest.raises(ValueError, match="too many archive entries"):
        read_document(path)
    # The reader and AI must report unavailable content rather than invent text.
    assert PreviewService().preview(str(path))["kind"] == "unsupported"
    assert AIToolManager()._read_file(str(path))["evidence_kind"] == "metadata"

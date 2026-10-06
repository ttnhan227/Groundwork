"""Deterministic storage labels; these never imply content-reading support."""

EXTENSIONS = {
    "media": ".mp4 .mkv .avi .mov .wmv .webm .mp3 .wav .flac .aac .png .jpg .jpeg .gif .webp .svg .ico .psd".split(),
    "archives": ".zip .tar .gz .tgz .7z .rar .bz2 .xz .iso .dmg .vmdk .vhdx".split(),
    "documents": ".pdf .doc .docx .xls .xlsx .ppt .pptx .odt .ods .rtf .epub".split(),
    "code": ".py .ts .tsx .js .jsx .rs .go .java .c .cpp .h .hpp .cs .html .css .scss .json .yaml .yml .xml .sql .sh .bat .ps1 .md .toml .env".split(),
}
LABELS = {"media": "Media", "archives": "Archives", "documents": "Documents", "code": "Code", "other": "Other"}
BY_EXTENSION = {ext: category for category, extensions in EXTENSIONS.items() for ext in extensions}


def storage_category(extension: str, name: str = "") -> str:
    return "code" if name.lower() == ".env" else BY_EXTENSION.get(extension.lower(), "other")


def backfill_categories(conn):
    cases, args = [], []
    for category, extensions in EXTENSIONS.items():
        cases.append(f"WHEN lower(extension) IN ({','.join('?' for _ in extensions)}) THEN ?")
        args.extend([*extensions, category])
    conn.execute(
        f"UPDATE inventory SET category=CASE WHEN kind!='file' THEN '' WHEN lower(name)='.env' THEN 'code' {' '.join(cases)} ELSE 'other' END",
        args,
    )


def refresh_categories(conn, workspace_id):
    conn.execute("DELETE FROM inventory_categories WHERE workspace_id=?", (workspace_id,))
    conn.execute(
        """INSERT INTO inventory_categories (workspace_id, category, file_count, size_bytes)
        SELECT workspace_id, category, count(*), coalesce(sum(size_bytes), 0)
        FROM inventory WHERE workspace_id=? AND kind='file' GROUP BY category""",
        (workspace_id,),
    )

"""Universal Hybrid Search Engine for Groundwork.

Combines:
1. Lexical retrieval via SQLite FTS5 (BM25 token & phrase matching).
2. Local MiniLM vectors, with a development hashing fallback.
3. Filename & path exact/fuzzy matches.
4. Recency boost (recently modified files prioritized).
5. Project relevance weighting.

Provides inspectable scores. Latency depends on corpus size and hardware.
"""

from __future__ import annotations

import json
import logging
import math
import re
import time
from datetime import datetime, timezone
from typing import Any

from app.database.local_db import LocalDatabase, get_db
from app.models.types import SearchResponse, SearchResultItem
from app.services.embeddings import cosine_similarity, get_embedding_engine

logger = logging.getLogger("groundwork.search")


class SearchEngine:
    """Universal hybrid search engine combining lexical, semantic, and structural signals."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def __init__(self) -> None:
        self.embeddings = get_embedding_engine()

    def search(
        self,
        query: str,
        workspace_id: str | None = None,
        project_id: str | None = None,
        search_mode: str = "hybrid",  # hybrid, lexical, semantic, filename
        limit: int = 25,
        mode: str | None = None,
        file_type: str | None = None,
        modified_after: float | None = None,
    ) -> SearchResponse:
        search_mode = mode or search_mode
        start_time = time.perf_counter()
        query_clean = query.strip()
        # 1. Filename & Path Matches
        filters = {"file_type": file_type, "modified_after": modified_after}
        filename_candidates = self._search_filenames(query_clean, workspace_id, project_id, limit=limit * 2, **filters)

        # 2. Lexical FTS5 Matches
        lexical_candidates = {}
        if query_clean and search_mode in ("hybrid", "lexical"):
            lexical_candidates = self._search_fts(query_clean, workspace_id, project_id, limit=limit * 2, **filters)

        # 3. Semantic Vector Matches
        semantic_candidates = {}
        if query_clean and search_mode in ("hybrid", "semantic"):
            semantic_candidates = self._search_semantic(query_clean, workspace_id, project_id, limit=limit * 2, **filters)

        # 4. Merge candidates by file_id
        all_file_ids = set(filename_candidates.keys()) | set(lexical_candidates.keys()) | set(semantic_candidates.keys())

        if not all_file_ids:
            duration = (time.perf_counter() - start_time) * 1000
            return SearchResponse(query=query, total_matches=0, results=[], duration_ms=round(duration, 2))

        # Retrieve file records for all candidate IDs
        file_records = self._fetch_file_records(list(all_file_ids))

        scored_results: list[SearchResultItem] = []
        now_ts = datetime.now(timezone.utc).timestamp()

        for fid, rec in file_records.items():
            fn_score = filename_candidates.get(fid, {}).get("score", 0.0)
            lex_info = lexical_candidates.get(fid, {})
            lex_score = lex_info.get("score", 0.0)
            sem_info = semantic_candidates.get(fid, {})
            sem_score = sem_info.get("score", 0.0)

            # Project boost
            proj_boost = 1.0 if project_id and rec["project_id"] == project_id else 0.0

            # Recency boost (exponential decay: within 24h = 1.0, 7d = 0.5, >30d = 0.1)
            age_days = max(0.0, (now_ts - rec["mtime"]) / 86400.0)
            recency_score = math.exp(-0.1 * age_days)

            # Transparent score weights
            if search_mode == "lexical":
                final_score = (0.7 * lex_score) + (0.3 * fn_score)
            elif search_mode == "semantic":
                final_score = (0.8 * sem_score) + (0.2 * fn_score)
            elif search_mode == "filename":
                final_score = fn_score
            else:  # hybrid
                final_score = (
                    (0.35 * lex_score)
                    + (0.30 * sem_score)
                    + (0.20 * fn_score)
                    + (0.10 * proj_boost)
                    + (0.05 * recency_score)
                )

            # Determine best snippet and line number
            snippet = lex_info.get("snippet") or sem_info.get("snippet") or f"{rec['filename']} ({rec['relative_path']})"
            line_no = lex_info.get("line") or sem_info.get("line") or 1

            matched_terms = list(set(
                lex_info.get("matched_terms", []) +
                filename_candidates.get(fid, {}).get("matched_terms", [])
            ))

            mtime_iso = datetime.fromtimestamp(rec["mtime"], tz=timezone.utc).isoformat()

            scored_results.append(SearchResultItem(
                file_id=fid,
                path=rec["path"],
                filename=rec["filename"],
                relative_path=rec["relative_path"],
                project_id=rec["project_id"],
                project_name=rec["project_name"],
                file_type=rec["file_type"],
                line_number=line_no,
                snippet=snippet[:400],
                matched_terms=matched_terms,
                score=round(final_score, 4),
                score_breakdown={
                    "lexical": round(lex_score, 4),
                    "semantic": round(sem_score, 4),
                    "filename": round(fn_score, 4),
                    "project_boost": round(proj_boost, 4),
                    "recency": round(recency_score, 4),
                },
                last_modified=mtime_iso,
                git_context=None,
            ))

        # Sort descending by final_score
        scored_results.sort(key=lambda x: (x.score, x.path) if query_clean else (x.last_modified or "", x.path), reverse=True)
        top_results = scored_results[:limit]

        duration = (time.perf_counter() - start_time) * 1000
        return SearchResponse(
            query=query,
            total_matches=len(scored_results),
            results=top_results,
            duration_ms=round(duration, 2),
            search_mode=search_mode,
        )

    def _search_filenames(
        self,
        query: str,
        workspace_id: str | None,
        project_id: str | None,
        limit: int = 50,
        file_type: str | None = None,
        modified_after: float | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Finds candidate files by filename and path token matching."""
        conn = self.db.get_connection()
        q_lower = query.lower()
        terms = [t for t in re.findall(r"[\w.-]+", q_lower) if len(t) >= 2]

        where_clauses = []
        params: list[Any] = []

        name_conditions = ["(filename LIKE ? OR relative_path LIKE ?)"]
        params.extend([f"%{query}%", f"%{query}%"])
        for t in terms:
            name_conditions.append("(filename LIKE ? OR relative_path LIKE ?)")
            params.extend([f"%{t}%", f"%{t}%"])
        where_clauses.append(f"({' OR '.join(name_conditions)})")

        if workspace_id:
            where_clauses.append("workspace_id = ?")
            params.append(workspace_id)
        if project_id:
            where_clauses.append("project_id = ?")
            params.append(project_id)

        if file_type:
            where_clauses.append("file_type = ?")
            params.append(file_type)
        if modified_after is not None:
            where_clauses.append("mtime >= ?")
            params.append(modified_after)
        sql = f"SELECT id, filename, relative_path FROM files WHERE {' AND '.join(where_clauses)} ORDER BY CASE WHEN lower(filename) = ? THEN 0 ELSE 1 END, mtime DESC LIMIT ?;"
        params.extend([q_lower, limit])
        rows = conn.execute(sql, params).fetchall()
        results: dict[str, dict[str, Any]] = {}

        for r in rows:
            fname = r["filename"].lower()
            rel = r["relative_path"].lower()
            matched = []
            score = 0.0

            if fname == q_lower:
                score = 1.0
                matched.append(query)
            elif q_lower in fname:
                score = 0.8
                matched.append(query)
            elif q_lower in rel:
                score = 0.6
                matched.append(query)
            else:
                for t in terms:
                    if t in fname:
                        score += 0.3
                        matched.append(t)
                    elif t in rel:
                        score += 0.15
                        matched.append(t)
                score = min(1.0, score)

            results[r["id"]] = {"score": score, "matched_terms": matched}

        return results

    def _search_fts(
        self,
        query: str,
        workspace_id: str | None,
        project_id: str | None,
        limit: int = 50,
        file_type: str | None = None,
        modified_after: float | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Queries SQLite FTS5 for content and chunk keyword matches."""
        conn = self.db.get_connection()
        # Clean query for FTS5 (escape quotes, split words)
        words = re.findall(r"\w+", query)
        if not words:
            return {}

        fts_query = " ".join([f'"{w}"*' for w in words])
        results: dict[str, dict[str, Any]] = {}

        try:
            # Query chunks FTS first for precise line snippets
            sql = """
            SELECT fc.file_id, c.line_start, c.content, bm25(fts_chunks) as rank
            FROM fts_chunks fc
            JOIN chunks c ON fc.chunk_id = c.id
            JOIN files f ON c.file_id = f.id
            WHERE fts_chunks MATCH ?
            """
            params: list[Any] = [fts_query]
            if workspace_id:
                sql += " AND f.workspace_id = ?"
                params.append(workspace_id)
            if project_id:
                sql += " AND f.project_id = ?"
                params.append(project_id)
            if file_type:
                sql += " AND f.file_type = ?"
                params.append(file_type)
            if modified_after is not None:
                sql += " AND f.mtime >= ?"
                params.append(modified_after)
            sql += f" ORDER BY rank ASC LIMIT {limit};"

            rows = conn.execute(sql, params).fetchall()
            if not rows and len(words) > 1:
                params[0] = " OR ".join(f'"{word}"*' for word in words)
                rows = conn.execute(sql, params).fetchall()
            for r in rows:
                fid = r["file_id"]
                # BM25 rank in SQLite: lower is better (more negative). Normalize to 0..1
                raw_rank = abs(float(r["rank"]))
                norm_score = raw_rank / (1.0 + raw_rank)

                if fid not in results or norm_score > results[fid]["score"]:
                    # Create excerpt
                    lines = r["content"].splitlines()
                    offset = next((i for i, line in enumerate(lines) if any(word.lower() in line.lower() for word in words)), 0)
                    snippet = "\n".join(lines[offset:offset + 6])[:400]
                    results[fid] = {
                        "score": norm_score,
                        "snippet": snippet,
                        "line": r["line_start"] + offset,
                        "matched_terms": words,
                    }
        except Exception as exc:
            logger.debug("FTS chunk search error (%s), trying file FTS", exc)

        return results

    def _search_semantic(
        self,
        query: str,
        workspace_id: str | None,
        project_id: str | None,
        limit: int = 50,
        file_type: str | None = None,
        modified_after: float | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Vector semantic similarity search over indexed chunks."""
        query_vec = self.embeddings.embed_text(query)
        conn = self.db.get_connection()

        sql = """
        SELECT c.file_id, c.line_start, c.content, c.embedding_json
        FROM chunks c
        JOIN files f ON c.file_id = f.id
        WHERE c.embedding_json IS NOT NULL AND f.hash LIKE ?
        """
        params: list[Any] = [self.embeddings.model_id + ":%"]
        if workspace_id:
            sql += " AND f.workspace_id = ?"
            params.append(workspace_id)
        if project_id:
            sql += " AND f.project_id = ?"
            params.append(project_id)
        if file_type:
            sql += " AND f.file_type = ?"
            params.append(file_type)
        if modified_after is not None:
            sql += " AND f.mtime >= ?"
            params.append(modified_after)

        rows = conn.execute(sql, params)
        results: dict[str, dict[str, Any]] = {}

        for r in rows:
            try:
                emb = json.loads(r["embedding_json"])
                sim = cosine_similarity(query_vec, emb)
                # Filter out negative / very low similarity
                if sim > 0.15:
                    fid = r["file_id"]
                    if fid not in results or sim > results[fid]["score"]:
                        results[fid] = {
                            "score": sim,
                            "snippet": r["content"][:250],
                            "line": r["line_start"],
                        }
            except Exception:
                continue

        return dict(sorted(results.items(), key=lambda item: item[1]["score"], reverse=True)[:limit])

    def _fetch_file_records(self, file_ids: list[str]) -> dict[str, dict[str, Any]]:
        conn = self.db.get_connection()
        placeholders = ",".join(["?"] * len(file_ids))
        sql = f"""
        SELECT f.*, p.name as project_name
        FROM files f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.id IN ({placeholders});
        """
        rows = conn.execute(sql, file_ids).fetchall()
        return {r["id"]: dict(r) for r in rows}

    @staticmethod
    def _highlight_snippet(content: str, words: list[str], max_chars: int = 250) -> str:
        """Finds first occurrence of matching word and extracts snippet window."""
        content_lower = content.lower()
        first_pos = -1
        for w in words:
            pos = content_lower.find(w.lower())
            if pos != -1 and (first_pos == -1 or pos < first_pos):
                first_pos = pos

        if first_pos == -1:
            return content[:max_chars].strip()

        start = max(0, first_pos - 40)
        end = min(len(content), start + max_chars)
        snippet = content[start:end].strip()
        prefix = "... " if start > 0 else ""
        suffix = " ..." if end < len(content) else ""
        return f"{prefix}{snippet}{suffix}"

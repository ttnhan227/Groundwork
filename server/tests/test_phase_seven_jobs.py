import uuid

import pytest
from fastapi import HTTPException

from app.jobs import _document_ids
from app.schemas import OperationJobCreate


def test_operation_job_extracts_and_deduplicates_document_ids() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()
    payload = OperationJobCreate(
        operation="comparison",
        parameters={
            "left_document_id": str(first),
            "right_document_id": str(second),
            "document_ids": [str(first)],
        },
    )
    assert _document_ids(payload) == [first, second]


def test_operation_job_rejects_invalid_document_ids() -> None:
    payload = OperationJobCreate(operation="summary", parameters={"document_id": "not-a-uuid"})
    with pytest.raises(HTTPException) as error:
        _document_ids(payload)
    assert error.value.status_code == 422


def test_operation_job_rejects_unknown_operations() -> None:
    with pytest.raises(ValueError):
        OperationJobCreate(operation="arbitrary_command", parameters={"document_id": str(uuid.uuid4())})

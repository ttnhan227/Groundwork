import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import JobStatus


class ProcessingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    document_id: uuid.UUID | None
    operation: str
    parameters: dict
    status: JobStatus
    progress: int
    retry_count: int
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    result_kind: str | None
    result_id: uuid.UUID | None
    created_at: datetime


class OperationJobCreate(BaseModel):
    operation: str = Field(
        pattern=(
            "^(summary|quiz|extraction|translation|comparison|merge|split|rotate|"
            "delete_pages|extract_pages|pdf_to_images|images_to_pdf|watermark|"
            "pdf_to_docx|docx_to_pdf|docx_to_markdown|compress_pdf|add_page_numbers|workflow)$"
        )
    )
    parameters: dict

    @field_validator("parameters")
    @classmethod
    def limit_parameters(cls, value: dict) -> dict:
        if len(str(value)) > 20_000:
            raise ValueError("Job parameters are too large")
        return value


class WorkflowPlanRequest(BaseModel):
    command: str = Field(min_length=3, max_length=2000)
    document_id: uuid.UUID


class WorkflowExecuteRequest(WorkflowPlanRequest):
    approved: bool = False


class WorkflowStep(BaseModel):
    id: str
    tool: str
    title: str
    parameters: dict
    risk: str
    confirmation_required: bool
    verification: str


class WorkflowPlanResponse(BaseModel):
    id: uuid.UUID
    status: str
    command: str
    document_id: uuid.UUID
    steps: list[WorkflowStep]
    confirmation_required: bool
    estimated_ai_calls: int


class PersistedWorkflowStep(BaseModel):
    id: uuid.UUID
    position: int
    capability: str
    title: str
    parameters: dict
    risk: str
    verification: str
    status: str


class PersistedWorkflowResponse(BaseModel):
    id: uuid.UUID
    status: str
    confirmation_required: bool
    job_id: uuid.UUID | None
    steps: list[PersistedWorkflowStep]


class WorkflowEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workflow_id: uuid.UUID
    event_type: str
    payload: dict
    created_at: datetime

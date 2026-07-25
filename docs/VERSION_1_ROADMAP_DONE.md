Build a complete portfolio-ready SaaS-style web application called **InsightPDF**** **

, an AI-powered PDF workspace for uploading, understanding, comparing, organizing, and transforming PDF documents.

The project must be fully implemented, runnable with Docker Compose, documented, tested, and suitable for deployment as a public portfolio demo.

## Primary Goal

Create a polished application where users can:

Register and sign in

Upload and manage PDF documents

Ask questions about PDFs using RAG

Receive answers with page-level citations

Generate summaries, key points, quizzes, and action items

Compare two PDF documents

Process scanned PDFs using OCR

Merge, split, rotate, delete, and extract PDF pages

Convert images to PDF

Convert PDF pages to images

Download processed files

The project should demonstrate production-oriented backend engineering, asynchronous processing, AI integration, vector search, authentication, testing, containerization, and deployment readiness.

# Technology Stack

## Frontend

Use:

React

TypeScript

Vite

Tailwind CSS

shadcn/ui

TanStack Query

React Router

React Hook Form

Zod

PDF.js

Playwright

Vitest

## Backend

Use:

Python

FastAPI

Pydantic

SQLAlchemy 2

Alembic

PostgreSQL

pgvector

Celery

Redis

MinIO

LangChain

Sentence Transformers

PyMuPDF

pypdf

Pillow

Tesseract OCR

pytest

## Infrastructure

Use:

Docker

Docker Compose

Nginx

GitHub Actions

Environment variables

Structured logging

The only required paid integration should be the configurable LLM API.

Support an OpenAI-compatible API through environment variables.

Local embeddings must use Sentence Transformers so that embedding generation does not require a paid API.

# Architecture

Use a modular monolith with independently running background workers.

React frontend
      |
      v
FastAPI REST API
      |
      +-- PostgreSQL
      |     +-- application data
      |     +-- pgvector embeddings
      |
      +-- Redis
      |     +-- Celery broker
      |     +-- result backend
      |     +-- caching
      |
      +-- MinIO
      |     +-- original files
      |     +-- processed files
      |
      +-- Celery workers
      |     +-- PDF extraction
      |     +-- OCR
      |     +-- embeddings
      |     +-- summaries
      |     +-- comparisons
      |     +-- PDF transformations
      |
      +-- LLM API

Do not divide the project into unnecessary microservices.

Keep strong module boundaries so document processing could be extracted into a separate service later.

# Backend Module Structure

Organize the FastAPI application approximately as follows:

app/
├── api/
│   ├── dependencies/
│   └── routes/
├── auth/
├── users/
├── documents/
├── pdf\_tools/
├── ai/
├── rag/
├── storage/
├── tasks/
├── database/
├── security/
├── common/
├── models/
├── schemas/
├── services/
├── repositories/
├── config/
└── main.py

Use clean separation between:

API routes

schemas

ORM models

repositories

application services

infrastructure integrations

Celery tasks

Avoid placing business logic directly inside route handlers.

# Authentication

Implement:

User registration

User login

JWT access tokens

Refresh-token rotation

Password hashing

Logout

Current-user endpoint

Role-based authorization

User and Admin roles

Store refresh tokens securely in the database using hashes.

Support access-token renewal through a refresh-token endpoint.

Prevent users from accessing documents belonging to other users.

# User Accounts

Each user should have:

ID

email

password hash

display name

role

account status

created timestamp

updated timestamp

Provide a profile page where users can:

View profile information

Update display name

Change password

View storage usage

View AI usage statistics

# Document Management

Users must be able to:

Upload PDFs

View uploaded documents

Rename documents

Delete documents

Download original files

Download processed files

View processing status

View page count

View file size

View upload date

Search documents by filename

Filter documents by status

Document statuses should include:

uploaded

extracting

OCR processing

indexing

ready

failed

Store file metadata in PostgreSQL and file contents in MinIO.

Use signed MinIO URLs or secure API download endpoints.

Apply configurable limits for:

Maximum file size

Maximum page count

Maximum documents per user

Maximum daily AI requests

# Upload Pipeline

When a PDF is uploaded:

Upload file
    |
    v
Validate extension and MIME type
    |
    v
Store original file in MinIO
    |
    v
Create document database record
    |
    v
Queue background processing task
    |
    v
Extract text using PyMuPDF
    |
    +-- meaningful text found
    |       |
    |       v
    |   continue processing
    |
    +-- insufficient text found
            |
            v
        render pages as images
            |
            v
        run Tesseract OCR
    |
    v
Split text into chunks
    |
    v
Generate local embeddings
    |
    v
Store chunks and vectors in PostgreSQL/pgvector
    |
    v
Mark document as ready

The API request must not wait for OCR, embedding, or indexing to finish.

Return the created document immediately with a processing status.

# RAG Document Chat

Implement conversational question answering over one or more selected documents.

Requirements:

Retrieve relevant chunks from pgvector

Filter retrieval by current user and selected document IDs

Send retrieved context to the configured LLM

Prevent unrelated users from retrieving each other’s chunks

Return page-level citations

Return source snippets

Support follow-up questions

Store conversations and messages

Allow users to create multiple conversations

Allow users to rename and delete conversations

Each answer should contain:

{
  "answer": "Generated answer",
  "citations": [
    {
      "document\_id": "uuid",
      "document\_name": "example.pdf",
      "page\_number": 4,
      "snippet": "Relevant source text"
    }
  ]
}

The frontend must let users click a citation and open the corresponding PDF page in the PDF viewer.

The model must be instructed to:

Answer only from retrieved document context

Clearly state when the answer cannot be found

Avoid inventing facts

Preserve page citations

# AI Features

Implement the following features.

## Document Summary

Generate:

Short summary

Detailed summary

Key points

Action items

Store completed results so repeated requests do not always call the LLM again.

## Quiz Generation

Generate configurable quizzes containing:

Multiple-choice questions

Correct answers

Explanations

Source page references

Allow the user to select the number of questions.

## Document Translation

Translate extracted text or selected pages.

Do not attempt to preserve the entire original PDF layout in the first version.

Provide translated content as:

Plain text

Markdown

Downloadable text file

## Information Extraction

Allow users to ask the AI to extract structured information.

Examples:

People

Dates

Companies

Monetary values

Deadlines

Action items

Custom fields

Validate structured AI responses using Pydantic schemas.

## Document Comparison

Allow users to select two PDFs and compare them.

Return:

Summary of major differences

Added sections

Removed sections

Changed sections

Important numerical changes

Referenced page numbers from both documents

Use deterministic text comparison where possible and the LLM for semantic explanations.

# PDF Tools

Implement the following realistic portfolio features.

## Merge PDFs

Select multiple PDFs

Reorder them

Merge into one PDF

Store and download the result

## Split PDF

Support:

Specific page ranges

One file per page

Selected pages only

## Rotate Pages

Allow rotation by:

90 degrees

180 degrees

270 degrees

Support individual page selection.

## Delete Pages

Allow users to preview and select pages for deletion.

## Extract Pages

Create a new PDF containing selected pages.

## PDF to Images

Convert pages to PNG or JPEG.

Allow configurable resolution.

## Images to PDF

Support:

JPG

JPEG

PNG

Allow users to reorder images before conversion.

## Watermark

Allow users to add:

Text watermark

Image watermark

Support:

Position

Opacity

Rotation

Page selection

Do not build:

Full arbitrary existing-text editing

Perfect PDF-to-Word conversion

Legally compliant signature-request workflows

Complex billing

Mobile applications

# OCR

Use Tesseract OCR only when extracted PDF text is insufficient.

Create a configurable text-density threshold.

Store OCR output page by page.

The Docker image used by the processing worker must install:

Tesseract

Required language packs

Any required PDF rendering system dependencies

Support English initially.

Design the OCR service so additional languages can be added later.

# Background Jobs

Use Celery and Redis.

Background tasks should include:

PDF text extraction

OCR

Chunking and embedding

Summary generation

Quiz generation

Document comparison

PDF merge

PDF split

Page extraction

Image conversion

Watermark creation

Every job should have:

Job ID

Status

Progress percentage

Started timestamp

Completed timestamp

Error message

Retry count

Statuses:

queued

running

completed

failed

Implement safe retries for temporary failures.

Do not retry permanently invalid input.

# Database Design

Create database models for at least:

users

refresh\_tokens

documents

document\_pages

document\_chunks

conversations

messages

citations

processing\_jobs

generated\_artifacts

ai\_usage\_records

Use UUID primary keys.

Store vector embeddings using pgvector.

Create indexes for:

user IDs

document ownership

processing status

timestamps

vector search

conversation lookup

Use Alembic migrations.

# Storage

Use MinIO for local and deployed portfolio environments.

Create separate buckets or logical prefixes for:

original documents

processed documents

page images

generated exports

Use a storage abstraction interface so MinIO could later be replaced by Azure Blob Storage or AWS S3.

The application must never expose unrestricted private object URLs.

# Frontend Pages

Implement:

## Public Pages

Landing page

Login

Registration

Demo information

## Authenticated Pages

Dashboard

Documents

Upload

Document details

PDF viewer

AI chat

Summary

Quiz generator

Document comparison

PDF tools

Processing jobs

Profile

## Admin Pages

User list

Document statistics

AI usage statistics

Failed job list

# Document Viewer

Use PDF.js.

Features:

Page navigation

Zoom

Search

Thumbnail sidebar

Current-page indicator

Citation navigation

Page selection for PDF tools

When a user clicks a chat citation, navigate directly to that page and visually indicate the cited section when practical.

# Dashboard

Show:

Total uploaded documents

Total pages processed

Storage usage

AI requests

Recently uploaded documents

Recent processing jobs

Failed jobs

Quick actions

Use charts only where they add real value.

# Demo Experience

The public deployment must be easy for recruiters to test.

Provide:

A visible demo account

Preloaded sample PDFs

At least one text-based PDF

At least one scanned PDF

At least two document versions for comparison

Clear sample questions

Processing progress UI

Graceful errors

Responsive design

The recruiter should be able to complete this flow:

Sign in
    |
    v
Open a sample PDF
    |
    v
Ask a question
    |
    v
Receive an answer with citations
    |
    v
Click a citation
    |
    v
Open the referenced page
    |
    v
Generate a summary
    |
    v
Compare two documents
    |
    v
Merge, split, or extract pages
    |
    v
Download the result

Do not require recruiters to supply their own LLM API key on the deployed demo.

Apply strict usage limits to protect the API budget.

# Security

Implement:

File MIME validation

File extension validation

PDF parsing validation

File-size limits

Page-count limits

Per-user authorization

Rate limiting

Safe generated filenames

Path traversal prevention

Input validation

Password hashing

JWT validation

Refresh-token revocation

CORS configuration

Security headers

Safe temporary-file cleanup

Protection against prompt injection where practical

Document limitations clearly.

Do not claim GDPR, ISO, legal compliance, or enterprise-grade security certifications.

# Error Handling

Use consistent API errors.

Example:

{
  "error": {
    "code": "DOCUMENT\_NOT\_READY",
    "message": "The document is still being processed.",
    "details": {}
  }
}

Create centralized exception handling.

Do not expose stack traces in production.

Store useful error details in structured logs.

# Testing

## Backend

Use pytest.

Include tests for:

Registration

Login

Refresh-token rotation

Authorization

Document ownership

File validation

Upload workflow

Processing status

PDF operations

RAG retrieval filters

Citation generation

Background-task behavior

Failure handling

Use unit tests and integration tests.

## Frontend

Use Vitest for:

Components

Hooks

Validation

API-state handling

Use Playwright for:

Registration and login

Uploading a PDF

Waiting for processing

Opening a document

Asking a question

Clicking a citation

Generating a summary

Running one PDF operation

Downloading a result

Tests must be executable through documented commands.

# Docker

Provide Dockerfiles for:

FastAPI API

Celery worker

React frontend

Provide a Docker Compose configuration containing:

frontend

API

worker

PostgreSQL with pgvector

Redis

MinIO

Nginx

Tesseract must be installed inside the worker image.

The complete project should start with:

docker compose up --build

Provide health checks for all appropriate services.

Do not depend on locally installed PostgreSQL, Redis, MinIO, Python, Node.js, or Tesseract when using Docker.

# CI/CD

Create GitHub Actions workflows for:

Backend linting

Backend tests

Frontend linting

Frontend tests

Playwright tests

Docker image builds

Optionally include deployment steps using secrets and environment variables.

CI must fail when tests or linting fail.

# Code Quality

Use:

Type hints throughout Python

Async FastAPI endpoints where appropriate

Clear service and repository boundaries

Dependency injection

Small focused classes and functions

Descriptive names

Docstrings for non-obvious logic

Centralized configuration

No hard-coded secrets

No placeholder implementations

No unimplemented TODO sections

Use a consistent Python formatter and linter such as Ruff.

Use ESLint and Prettier for the frontend.

# API Documentation

Use FastAPI OpenAPI documentation.

Document:

Authentication

Upload endpoints

Document endpoints

Chat endpoints

AI endpoints

PDF tool endpoints

Job-status endpoints

Error responses

Provide request and response examples.

# README

Create a professional README containing:

Project overview

Screenshots

Feature list

Architecture diagram

Technology stack

Local setup

Docker setup

Environment variables

Database migration commands

Test commands

Demo account

API documentation URL

Design decisions

Known limitations

Future improvements

Include a concise explanation of why the application uses:

FastAPI

Celery

Redis

PostgreSQL

pgvector

MinIO

Tesseract

RAG

# Environment Variables

Provide a complete .env.example.

Include variables for:

Application environment

Database connection

Redis connection

MinIO connection

JWT secrets

Access-token lifetime

Refresh-token lifetime

LLM API key

LLM base URL

LLM model

Embedding model

Maximum file size

Maximum page count

AI request limits

CORS origins

Never commit real secrets.

# Implementation Order

Implement the project in phases.

## Phase 1

Docker Compose

FastAPI foundation

PostgreSQL

User registration and login

React foundation

Document upload

MinIO storage

## Phase 2

Celery and Redis

Text extraction

OCR

Processing status

PDF viewer

## Phase 3

Chunking

Local embeddings

pgvector

RAG chat

Page citations

## Phase 4

Summaries

Quiz generation

Structured extraction

Document comparison

## Phase 5

Merge

Split

Rotate

Delete pages

Extract pages

PDF/image conversion

Watermarking

## Phase 6

Tests

Security improvements

Demo data

CI/CD

Deployment documentation

UI polish

Complete each phase with working tests before moving to the next one.

# Final Deliverables

Produce:

Complete backend source code

Complete frontend source code

Database migrations

Dockerfiles

Docker Compose configuration

Nginx configuration

GitHub Actions workflows

Automated tests

Sample documents

Seed/demo account support

.env.example

Professional README

Architecture documentation

The final application must not contain placeholder code, fake integrations, or incomplete core features.

Prioritize a polished, reliable demonstration over implementing many shallow tools.

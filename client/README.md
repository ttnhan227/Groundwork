# Groundwork Client

Standard Vite + React single-page application for Groundwork.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

Set `VITE_API_URL` before building when the API is not available at the
same-origin `/api/v1` path.

## Commands

- `npm run dev`: start local development
- `npm run build`: create the static production bundle in `dist/`
- `npm run preview`: preview the production bundle
- `npm test`: build and run frontend tests
- `npm run lint`: run ESLint

## Render

The repository-level `render.yaml` configures this directory as a Render Static
Site. Set `VITE_API_URL` in Render to the public backend URL ending in `/api/v1`.

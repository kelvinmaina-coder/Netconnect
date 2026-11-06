# NetConnect frontend

React + TypeScript + Vite workspace UI for the existing NetConnect API.

## Run locally

From this directory:

```bash
npm install
cp .env.example .env.local  # optional; edit the API URL if needed
npm run dev
```

The development server prints its local URL. Set `VITE_API_BASE_URL` when the backend is not at `http://localhost:8000`, for example `VITE_API_BASE_URL=http://127.0.0.1:8000`.

Build for production with `npm run build`; preview the generated `dist/` with `npm run preview`.

## Included screens

- Sign in and account registration using the API auth endpoints
- Workspace overview with current room, file, and transfer counts
- Room creation, joining, room message listing, and sending
- Private conversation summaries and sending by recipient user ID
- File metadata, TCP transfer configuration, and recorded transfer history
- Administrator-only user roster and suspend/reactivate controls
- Analytics and monitoring views based only on endpoints the current backend actually exposes

Private-message history, HTTP file uploads, analytics time series, and server health metrics are not exposed by the current API. The UI clearly communicates those limits rather than showing fabricated data. File bytes are handled by the separate TCP transfer service described by `/api/v1/files/tcp-info`.

## Backend

Start the API from the repository root with:

```bash
uvicorn backend.api.app:app --reload --host 127.0.0.1 --port 8000
```

The API must permit browser requests from the frontend origin (CORS). If the browser reports a CORS error, configure the backend's allowed origins for the Vite development URL.

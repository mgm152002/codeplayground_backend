# CodePlayground Backend

Express backend for secure multi-language code execution, AI assistance via OpenRouter free models, and S3-based file storage.

## Highlights

- Secure Docker sandbox execution for C/C++/JS/Python/Go/Rust/Java
- Input validation with execution resource/time limits
- Save/list/read/rename/delete source files in S3
- OpenRouter AI endpoint with free-model fallback and runtime model discovery
- Runtime metadata (`/runtime`) and health checks (`/health`)
- Helmet headers, CORS allowlist, and API rate limiting
- Prometheus metrics endpoint (optional token)

## Stack

- Node.js + Express
- AWS SDK (S3)
- Docker runtime image: `comp`
- OpenRouter API
- prom-client

## Prerequisites

- Node.js 18+
- Docker Desktop running
- AWS credentials with S3 permissions
- `comp` image built for your architecture

## Environment Variables

Create `.env`:

```env
# AWS
accessKeyId=...
secretAccessKey=...
Region=ap-south-1
S3_BUCKET=codeplayground-bucket

# Server
PORT=8000
ALLOWED_ORIGINS=http://localhost:3000
METRICS_TOKEN=

# Execution
EXECUTION_TIMEOUT_MS=8000

# OpenRouter
API_KEY=sk-or-v1-...
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=codeplayground
OPENROUTER_FREE_MODELS=
OPENROUTER_MODEL_CACHE_MS=600000
```

## Build Compiler Image (Apple Silicon / M1)

```bash
docker build --platform linux/arm64 -t comp -f DockerFiles/Dockerfile .
```

## Run

```bash
npm install
npm run dev
# or
npm start
```

Server runs at `http://localhost:8000`.

## API

- `POST /compile` compile + run + save
- `POST /saveCode` save source file
- `GET /getCode` list files for an email
- `GET /getCodeValue` read a file
- `POST /renameCode` rename a file
- `DELETE /deleteCode` delete a file
- `POST /codeAi` AI response (`prompt`, `code`, optional `model`)
- `GET /runtime` available languages/models and limits
- `GET /health` backend health
- `GET /metrics` Prometheus metrics

## Notes

- Code execution is isolated using short-lived Docker containers.
- Backend expects execution image tag `comp`.

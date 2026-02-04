# RAG Compliance Engine

A Retrieval Augmented Generation (RAG) service that lets you ask natural language questions against a corpus of regulatory standards. Point it at JSON files from any standards scraper, and it will embed them into a vector database and provide an API for intelligent compliance queries.

## Example

```bash
curl -X POST http://localhost:3000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Which standards apply to a wireless implantable cardiac monitor?"}'
```

```json
{
  "answer": "The applicable standards for a wireless implantable cardiac monitor are: 1. ISO/IEEE 11073-10103:2025 — nomenclature for implantable cardiac devices... 2. ISO 14117:2019 — EMC test protocols for active implantable cardiovascular devices...",
  "sources": [
    {
      "id": "ISO--IEEE-11073-10103-2025",
      "standardNumber": "ISO/IEEE 11073-10103:2025",
      "title": "Health informatics — Device interoperability — Part 10103: Nomenclature, implantable device, cardiac",
      "relevance": 0.668
    }
  ]
}
```

## How It Works

```
JSON files (standards data)
    │
    ▼
┌──────────┐     ┌──────────────────────┐
│  ingest   │────▶│  OpenAI Embeddings    │
│  (CLI)    │     │  text-embedding-3-sm  │
└──────────┘     └──────────┬───────────┘
                            ▼
                 ┌──────────────────────┐
                 │      ChromaDB         │
                 │   (vector store)      │
                 └──────────┬───────────┘
                            │
┌──────────┐     ┌──────────┴───────────┐     ┌─────────────┐
│  POST     │────▶│  Semantic search      │────▶│  GPT-4o      │
│  /ask     │     │  (top-5 retrieval)    │     │  + context   │
└──────────┘     └──────────────────────┘     └──────┬──────┘
                                                     ▼
                                              JSON response
                                            (answer + sources)
```

1. **Ingest** — Standards JSON files are loaded, deduplicated, and each standard is converted into a text document (number + title + scope + classification codes). These documents are embedded using OpenAI's `text-embedding-3-small` model and stored in ChromaDB.

2. **Query** — When a question comes in, it is embedded using the same model. ChromaDB performs a cosine similarity search to find the 5 most semantically relevant standards.

3. **Generate** — The retrieved standards are injected into a system prompt and sent to GPT-4o, which produces a grounded answer citing only the retrieved standards.

## Input Data Format

The engine accepts JSON files containing arrays of standard objects. Each object should have at minimum:

```json
{
  "id": "ISO-14708-1-2014",
  "standardNumber": "ISO 14708-1:2014",
  "title": "Implants for surgery — Active implantable medical devices — Part 1",
  "scope": "This document specifies requirements for active implantable medical devices..."
}
```

### Supported fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (used as ChromaDB document ID) |
| `standardNumber` | string | Yes | The standard's official number (e.g. `ISO 14708-1:2014`) |
| `title` | string | Yes | Full title of the standard |
| `scope` | string \| null | No | Scope/abstract text — significantly improves retrieval quality |
| `source` | string | No | Source identifier (e.g. `EU_HARMONISED`) |
| `sdoName` | string | No | Standards development organisation (e.g. `ISO`, `IEEE`) |
| `icsClassifications` | string[] | No | ICS classification codes |
| `icsCodes` | string[] | No | Alternative field name for ICS codes |
| `category` | string | No | Category label |
| `subcategory` | string | No | Subcategory label |
| `regulationReference` | string | No | Associated regulation (e.g. EU regulation number) |

Place your JSON files in a directory and set `STANDARDS_DIR` in `.env` to point at it. Files matching `*not-found*` are automatically skipped. Duplicate IDs across files are deduplicated, preferring entries that have scope text.

## Prerequisites

- **Node.js** >= 18
- **Docker** (for ChromaDB)
- **OpenAI API key** with billing enabled

## Setup

```bash
# Clone the repo
git clone https://github.com/muhammaddevops/rag-compliance-engine.git
cd rag-compliance-engine

# Install dependencies
npm install

# Start ChromaDB
docker run -d -p 8000:8000 chromadb/chroma

# Configure environment
cp .env.example .env
# Edit .env — add your OPENAI_API_KEY and set STANDARDS_DIR to your JSON files location
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required. Your OpenAI API key |
| `STANDARDS_DIR` | `./data` | Path to directory containing standards JSON files |
| `CHROMA_HOST` | `localhost` | ChromaDB host |
| `CHROMA_PORT` | `8000` | ChromaDB port |
| `PORT` | `3000` | Express API port |

## Usage

### Ingest standards

```bash
# Ingest all JSON files from STANDARDS_DIR
npm run ingest

# Ingest a single file (by filename within STANDARDS_DIR)
npm run ingest -- my-standards.json

# Ingest a single file (by absolute path)
npm run ingest -- /path/to/standards.json
```

### Start the API

```bash
npm start
```

### Query the API

```bash
curl -X POST http://localhost:3000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Which standards apply to electrical safety in medical devices?"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | Natural language compliance question |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `answer` | string | GPT-4o generated answer grounded in retrieved standards |
| `sources` | array | Top 5 matched standards with relevance scores |
| `sources[].id` | string | Standard ID |
| `sources[].standardNumber` | string | Official standard number |
| `sources[].title` | string | Standard title |
| `sources[].relevance` | number | Similarity score (0–1, higher = more relevant) |

## Project Structure

```
rag-compliance-engine/
├── src/
│   ├── config.ts      # Environment variables and constants
│   ├── ingest.ts      # Load JSON → deduplicate → embed → store in ChromaDB
│   ├── query.ts       # Embed question → retrieve from ChromaDB → generate answer via GPT-4o
│   └── server.ts      # Express API (POST /ask)
├── .env.example       # Environment template
├── package.json
└── tsconfig.json
```

## Stack

| Component | Technology |
|-----------|-----------|
| Vector database | ChromaDB |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | GPT-4o |
| API framework | Express 5 |
| Language | TypeScript (ESM) |

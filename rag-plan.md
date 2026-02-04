# RAG Compliance Engine

Natural language queries against 7,100+ scraped standards:

```
"Which standards apply to a wireless implantable cardiac monitor?"
  → Retrieves: IEC 62304 (software), ISO 14708 (implants), EN 60601 (electrical safety)
  → Explains why each applies based on scope text
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     STANDARD SCRAPER REPO                       │
│                                                                 │
│  ISO Website ──┐                                                │
│  IEEE Xplore ──┼──→ Scrapers ──→ JSON files (7,100+ standards) │
│  EU Commission ┘                   │                            │
└────────────────────────────────────┼────────────────────────────┘
                                     │ STANDARDS_DIR points here
┌────────────────────────────────────┼────────────────────────────┐
│                  RAG COMPLIANCE ENGINE                          │
│                                     ▼                           │
│  ┌──────────┐    ┌──────────────────────────┐                   │
│  │  ingest   │───→│  For each standard:       │                  │
│  │  (CLI)    │    │  1. Build document text   │                  │
│  └──────────┘    │  2. Embed (OpenAI)        │                  │
│                  │  3. Store in ChromaDB     │                  │
│                  └──────────┬───────────────┘                   │
│                             ▼                                   │
│                  ┌──────────────────┐                            │
│                  │    ChromaDB       │                            │
│                  │  (vector store)   │                            │
│                  │  7,100 embeddings │                            │
│                  └────────┬─────────┘                            │
│                           │                                     │
│  ┌──────────┐    ┌───────┴────────┐    ┌───────────────┐        │
│  │  User     │───→│  query.ts       │───→│  OpenAI GPT-4o │       │
│  │  Question │    │  1. Embed query │    │  + retrieved   │       │
│  └──────────┘    │  2. Top-5 match │    │    context     │       │
│                  └────────────────┘    └───────┬───────┘        │
│                                               ▼                 │
│                                      ┌─────────────────┐        │
│                                      │  JSON response   │        │
│                                      │  answer + sources │       │
│                                      └─────────────────┘        │
│                                                                 │
│  Express API: POST /ask ──→ query ──→ respond                   │
└─────────────────────────────────────────────────────────────────┘
```

## Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Vector DB | ChromaDB (Docker) | No signup, free, local |
| Embeddings | OpenAI `text-embedding-3-small` | $0.02/1M tokens |
| LLM | GPT-4o | Best reasoning for compliance |
| API | Express 5 | Minimal |
| Language | TypeScript (ESM) | Matches scraper codebase |

## Repo Structure

```
rag-compliance-engine/
├── src/
│   ├── config.ts          # Env vars, constants (CHROMA_HOST/PORT, OPENAI_API_KEY, STANDARDS_DIR)
│   ├── ingest.ts          # Load JSONs → embed → store in Chroma
│   ├── query.ts           # Retrieve + generate answer
│   └── server.ts          # Express API (POST /ask)
├── package.json
├── tsconfig.json
├── .env                   # OPENAI_API_KEY, STANDARDS_DIR
└── .env.example
```

## Usage

```bash
# 1. Start ChromaDB
docker run -d -p 8000:8000 chromadb/chroma

# 2. Add OpenAI key to .env
#    OPENAI_API_KEY=sk-...

# 3. Ingest standards (reads from STANDARDS_DIR in .env)
npm run ingest

# 4. Start API
npm start

# 5. Query
curl -X POST http://localhost:3000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Which standards apply to a wireless implantable cardiac monitor?"}'
```

## Notes

- STANDARDS_DIR points directly at json files locally — add the path in .env
- ChromaDB v3 uses `{ host, port }` config (not a URL string)
- Files matching `*not-found*` in the scraper output are skipped during ingestion
- Ingestion batches in groups of 100 to avoid API rate limits

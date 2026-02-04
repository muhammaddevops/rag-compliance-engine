# RAG Compliance Engine

Separate repo: `standards-rag`

## What It Does

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
                                     │ copy / mount / S3
┌────────────────────────────────────┼────────────────────────────┐
│                     STANDARDS-RAG REPO                          │
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
| API | Express | Minimal |
| Language | TypeScript | Matches scraper codebase |

## Repo Structure

```
standards-rag/
├── src/
│   ├── config.ts          # Env vars, constants
│   ├── ingest.ts          # Load JSONs → embed → store in Chroma
│   ├── query.ts           # Retrieve + generate answer
│   └── server.ts          # Express API (POST /ask)
├── data/                  # Standards JSON files (copied from scraper)
├── package.json
├── tsconfig.json
└── .env                   # OPENAI_API_KEY
```

## Dependencies

```json
{
  "dependencies": {
    "chromadb": "^3.2.0",
    "@chroma-core/openai": "^0.1.0",
    "openai": "^4.0.0",
    "express": "^4.18.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```

## Prerequisites

```bash
# ChromaDB server (pick one)
docker run -d -p 8000:8000 chromadb/chroma
# or: pip install chromadb && chroma run --path ./chroma-data

# OpenAI API key
echo "OPENAI_API_KEY=sk-..." > .env
```

## Implementation

### Step 1: Config (`src/config.ts`)

```typescript
import 'dotenv/config';

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
export const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
export const COLLECTION_NAME = 'standards';
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const CHAT_MODEL = 'gpt-4o';
export const TOP_K = 5;
export const STANDARDS_DIR = process.env.STANDARDS_DIR || './data';
```

### Step 2: Ingest (`src/ingest.ts`)

Loads all standards JSON files, builds document text per standard, embeds into Chroma.

```typescript
import fs from 'fs/promises';
import path from 'path';
import { ChromaClient } from 'chromadb';
import { OpenAIEmbeddingFunction } from '@chroma-core/openai';
import { OPENAI_API_KEY, COLLECTION_NAME, EMBEDDING_MODEL, STANDARDS_DIR } from './config.js';

interface StandardDoc {
  id: string;
  standardNumber: string;
  title: string;
  scope: string | null;
  source: string;
  sdoName?: string;
  icsClassifications?: string[];
  category?: string;
  subcategory?: string;
  regulationReference?: string;
  icsCodes?: string[];
}

function buildDocument(s: StandardDoc): string {
  const parts = [
    s.standardNumber,
    s.title,
    s.scope || '',
    s.icsClassifications?.join(', ') || s.icsCodes?.join(', ') || '',
    s.category || '',
    s.subcategory || '',
    s.regulationReference ? `EU Regulation ${s.regulationReference}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

function buildMetadata(s: StandardDoc): Record<string, string> {
  return {
    standardNumber: s.standardNumber,
    title: s.title,
    source: s.sdoName || s.source || 'unknown',
    hasScope: s.scope ? 'true' : 'false',
  };
}

async function ingest() {
  const dir = path.resolve(STANDARDS_DIR);
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json') && !f.includes('not-found'));

  const allStandards: StandardDoc[] = [];
  for (const file of files) {
    const data = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8'));
    if (Array.isArray(data)) allStandards.push(...data);
  }

  console.log(`Loaded ${allStandards.length} standards from ${files.length} files`);

  const client = new ChromaClient();
  const embeddingFunction = new OpenAIEmbeddingFunction({
    apiKey: OPENAI_API_KEY,
    modelName: EMBEDDING_MODEL,
  });

  try { await client.deleteCollection({ name: COLLECTION_NAME }); } catch {}

  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction,
  });

  const BATCH_SIZE = 100;
  for (let i = 0; i < allStandards.length; i += BATCH_SIZE) {
    const batch = allStandards.slice(i, i + BATCH_SIZE);
    await collection.add({
      ids: batch.map(s => s.id),
      documents: batch.map(buildDocument),
      metadatas: batch.map(buildMetadata),
    });
    console.log(`Ingested ${Math.min(i + BATCH_SIZE, allStandards.length)}/${allStandards.length}`);
  }

  console.log('Ingestion complete');
}

ingest().catch(console.error);
```

### Step 3: Query (`src/query.ts`)

```typescript
import OpenAI from 'openai';
import { ChromaClient } from 'chromadb';
import { OpenAIEmbeddingFunction } from '@chroma-core/openai';
import { OPENAI_API_KEY, COLLECTION_NAME, EMBEDDING_MODEL, CHAT_MODEL, TOP_K } from './config.js';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const client = new ChromaClient();
const embeddingFunction = new OpenAIEmbeddingFunction({
  apiKey: OPENAI_API_KEY,
  modelName: EMBEDDING_MODEL,
});

export interface QueryResult {
  answer: string;
  sources: Array<{ id: string; standardNumber: string; title: string; relevance: number }>;
}

export async function askQuestion(question: string): Promise<QueryResult> {
  const collection = await client.getCollection({ name: COLLECTION_NAME, embeddingFunction });

  const results = await collection.query({
    queryTexts: [question],
    nResults: TOP_K,
  });

  const docs = results.documents?.[0] ?? [];
  const metas = results.metadatas?.[0] ?? [];
  const ids = results.ids?.[0] ?? [];
  const distances = results.distances?.[0] ?? [];

  const context = docs.map((doc, i) =>
    `[${i + 1}] ${metas[i]?.standardNumber || ids[i]}\n${doc}`
  ).join('\n\n---\n\n');

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a regulatory compliance assistant for medical device manufacturers.
Given the user's question about their device, identify which standards apply and why.
Use ONLY the provided standards context. Cite standards by number.
If the context doesn't contain relevant standards, say so.

<standards>
${context}
</standards>`,
      },
      { role: 'user', content: question },
    ],
  });

  return {
    answer: completion.choices[0].message.content ?? '',
    sources: ids.map((id, i) => ({
      id,
      standardNumber: (metas[i]?.standardNumber as string) || id,
      title: (metas[i]?.title as string) || '',
      relevance: 1 - (distances[i] || 0),
    })),
  };
}
```

### Step 4: API Server (`src/server.ts`)

```typescript
import express from 'express';
import { askQuestion } from './query.js';

const app = express();
app.use(express.json());

app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const result = await askQuestion(question);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RAG API running on http://localhost:${PORT}`));
```

## Usage

```bash
# 1. Copy standards data from scraper
cp ../standard-scraper/output/*.json ./data/

# 2. Start ChromaDB
docker run -d -p 8000:8000 chromadb/chroma

# 3. Ingest standards
npx tsx src/ingest.ts

# 4. Start API
npx tsx src/server.ts

# 5. Query
curl -X POST http://localhost:3000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Which standards apply to a wireless implantable cardiac monitor?"}'
```

## Build Order

1. Init repo, install deps, tsconfig
2. `config.ts`
3. `ingest.ts` → test with `npx tsx src/ingest.ts`
4. `query.ts` → test with a quick script
5. `server.ts` → test with curl

## CV Keywords This Covers

- **RAG** (retrieval augmented generation)
- **Vector stores** (ChromaDB)
- **Embeddings** (OpenAI text-embedding-3-small)
- **Semantic search** (similarity-based retrieval)
- **LLM-based solution shipped** (API endpoint)
- **Search index optimization** (chunking, metadata filtering)
- **API development** (Express REST)

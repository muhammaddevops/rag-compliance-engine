import fs from 'fs/promises';
import path from 'path';
import { ChromaClient } from 'chromadb';
import { OpenAIEmbeddingFunction } from '@chroma-core/openai';
import { OPENAI_API_KEY, CHROMA_HOST, CHROMA_PORT, COLLECTION_NAME, EMBEDDING_MODEL, STANDARDS_DIR } from './config.js';

interface StandardDoc {
  id: string;
  standardNumber: string;
  title: string;
  scope: string | null;
  source?: string;
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
  const fileArg = process.argv[2]; // optional: pass a specific file path
  const dir = path.resolve(STANDARDS_DIR);

  let files: string[];
  if (fileArg) {
    // Single file mode: accept absolute path or filename within STANDARDS_DIR
    const resolved = path.isAbsolute(fileArg) ? fileArg : path.join(dir, fileArg);
    files = [resolved];
  } else {
    files = (await fs.readdir(dir))
      .filter(f => f.endsWith('.json') && !f.includes('not-found'))
      .map(f => path.join(dir, f));
  }

  const allStandards: StandardDoc[] = [];
  for (const file of files) {
    const data = JSON.parse(await fs.readFile(file, 'utf-8'));
    if (Array.isArray(data)) allStandards.push(...data);
  }

  // Deduplicate by ID — prefer entries with scope text
  const seen = new Map<string, StandardDoc>();
  for (const s of allStandards) {
    const existing = seen.get(s.id);
    if (!existing || (!existing.scope && s.scope)) {
      seen.set(s.id, s);
    }
  }
  const unique = [...seen.values()];
  console.log(`Loaded ${allStandards.length} standards from ${files.length} file(s) (${unique.length} unique after dedup)`);

  const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
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
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    await collection.add({
      ids: batch.map(s => s.id),
      documents: batch.map(buildDocument),
      metadatas: batch.map(buildMetadata),
    });
    console.log(`Ingested ${Math.min(i + BATCH_SIZE, unique.length)}/${unique.length}`);
  }

  console.log('Ingestion complete');
}

ingest().catch(console.error);

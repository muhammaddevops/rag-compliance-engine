import OpenAI from 'openai';
import { ChromaClient } from 'chromadb';
import { OpenAIEmbeddingFunction } from '@chroma-core/openai';
import { OPENAI_API_KEY, CHROMA_HOST, CHROMA_PORT, COLLECTION_NAME, EMBEDDING_MODEL, CHAT_MODEL, TOP_K } from './config.js';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
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

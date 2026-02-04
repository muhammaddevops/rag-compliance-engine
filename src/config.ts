import 'dotenv/config';

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
export const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost';
export const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8000', 10);
export const COLLECTION_NAME = 'standards';
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const CHAT_MODEL = 'gpt-4o';
export const TOP_K = 5;
export const STANDARDS_DIR = process.env.STANDARDS_DIR || './data';

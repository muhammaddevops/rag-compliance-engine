import express from 'express';
import { askQuestion } from './query.js';

const app = express();
app.use(express.json());

app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }

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

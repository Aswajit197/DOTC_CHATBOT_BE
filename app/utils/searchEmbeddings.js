require("dotenv").config({ path: __dirname + "/../.env" }); // load .env from root

const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load embeddings from JSON
const embeddingsData = JSON.parse(
  fs.readFileSync("api_embeddings.json", "utf-8")
);

// Function to calculate cosine similarity
function cosineSimilarity(vecA, vecB) {
    const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dot / (normA * normB);
  }
  
  export async function searchAPIs(query) {
    // Create embedding for the user query
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
  
    const queryEmbedding = embeddingResponse.data[0].embedding;
  
    // Compare query with each API embedding
    const results = embeddingsData.map((api) => {
      const similarity = cosineSimilarity(queryEmbedding, api.embedding);
      return {
        id: api.id,
        name: api.metadata.name,
        description: api.metadata.description,
        requiredFields: api.metadata.requiredFields,
        similarity,
      };
    });
  
    // Sort & get top 3
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
  }

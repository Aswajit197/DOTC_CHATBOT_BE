const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load embeddings from JSON
const embeddingsData = JSON.parse(fs.readFileSync("training/api_embeddings.json", "utf-8"));

// Function to calculate cosine similarity
function cosineSimilarity(vecA, vecB) {
	const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
	const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
	const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
	return dot / (normA * normB);
}

async function searchAPIs(query) {
	const embeddingResponse = await client.embeddings.create({
		model: "text-embedding-3-small",
		input: query,
	});

	const queryEmbedding = embeddingResponse.data[0].embedding;

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

	return results.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

module.exports = { searchAPIs };

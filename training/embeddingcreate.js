require("dotenv").config({ path: __dirname + "/../.env" }); // load .env from root

const fs = require("fs");
const OpenAI = require("openai");

const raw = fs.readFileSync("apiList.json", "utf-8");
const apiDocs = JSON.parse(raw);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function createEmbeddings() {
	const results = [];

	for (const api of apiDocs) {
		const text = `
        Name: ${api.name}
        Description: ${api.description}
        Required Fields: ${api.requiredFields?.length ? api.requiredFields.join(", ") : "None"}
      `;

		const response = await client.embeddings.create({
			model: "text-embedding-3-small", // or "text-embedding-3-large"
			input: text,
		});

		results.push({
			id: api.id || api.name,
			embedding: response.data[0].embedding,
			metadata: api, // keep original data
		});
	}

	return results;
}

(async () => {
	try {
		const embeddings = await createEmbeddings();
		fs.writeFileSync("api_embeddings.json", JSON.stringify(embeddings, null, 2));
		console.log("✅ Embeddings saved to api_embeddings.json");
	} catch (err) {
		console.error("❌ Error creating embeddings:", err);
	}
})();

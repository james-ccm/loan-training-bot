const admin = require("firebase-admin");
const { OpenAI } = require("openai");
require("dotenv").config();

// Initialize Firebase
const serviceAccount = require("./loan-training-bot-firebase-adminsdk-fbsvc-852bef515f.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });
  return response.data[0].embedding;
}

async function generateAndSaveEmbeddings() {
  const snapshot = await db.collection("training_data").get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.embedding) {
      console.log(`🔹 Generating embedding for: ${data.question}`);
      const embedding = await getEmbedding(data.question);

      await doc.ref.update({ embedding });
      console.log(`✅ Saved embedding for: ${data.question}`);
    }
  }

  console.log("🎉 All embeddings generated and saved!");
  process.exit();
}

generateAndSaveEmbeddings();

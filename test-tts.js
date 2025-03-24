const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;

async function synthesizeSpeech() {
  const client = new textToSpeech.TextToSpeechClient();

  const text = 'Hello, this is a test of Google Text-to-Speech from a Node.js script.';
  const request = {
    input: { text: text },
    voice: { languageCode: 'en-US', name: 'en-US-Neural2-D' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);
  const filename = 'output.mp3';
  await fs.writeFile(filename, response.audioContent, 'binary');
  console.log(`Audio content written to file: ${response}`);
}

synthesizeSpeech();
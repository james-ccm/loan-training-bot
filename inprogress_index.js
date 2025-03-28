"use strict";

/****************************************************
 * index.js - Simplified Voicebot (Twilio + OpenAI)
 *
 * Integrates:
 *  - Express for the web server.
 *  - Twilio for handling voice calls.
 *  - OpenAI (GPT-4.5+ SDK) for response generation.
 ****************************************************/

// -----------------------------
// 1. Load Dependencies & Environment
// -----------------------------
const express = require("express");
const twilio = require("twilio");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const nodemailer = require("nodemailer");
const fs = require("fs");
const speech = require('@google-cloud/speech');
require("dotenv").config();

const conversationLogs = {};  // Stores conversations indexed by CallSid
const queryCache = new Map(); // ⏩ Stores past responses

// -----------------------------
// 2. Initialize External Services
// -----------------------------
// Initialize OpenAI SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Load system prompt (from prompt.txt) once at startup
const defaultMapping = {
	prompt: fs.readFileSync("prompt.txt", "utf8"); //directed to use ("prompt_default.txt")
	voice: "Polly.Joanna"
};
const phoneMapping = {
  "+16566664149": {
    prompt: fs.readFileSync("prompt.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+19513832899": {
    prompt: fs.readFileSync("prompt2.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+18108888746": {
    prompt: fs.readFileSync("prompt3.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+17627722672": {
    prompt: fs.readFileSync("prompt4.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+19496823885": {
    prompt: fs.readFileSync("prompt5.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+16207505550": {
    prompt: fs.readFileSync("prompt6.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+19472084722": {
    prompt: fs.readFileSync("prompt7.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+15179831460": {
    prompt: fs.readFileSync("prompt8.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+17792612258": {
    prompt: fs.readFileSync("prompt9.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+12164467729": {
    prompt: fs.readFileSync("prompt10.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+12162796555": {
    prompt: fs.readFileSync("prompt11.txt", "utf8"),
    voice: "Polly.Salli"
  },
  "+12168687144": {
    prompt: fs.readFileSync("prompt12.txt", "utf8"),
    voice: "Polly.Salli"
  }
  // add additional mappings here...
};

// Initialize Google Speech-to-Text client
const speechClient = new speech.SpeechClient({
  keyFilename: 'C:\\Users\\JamesB\\OneDrive - CrossCountry Mortgage, LLC\\Desktop\\loan-training-bot\\serviceAccountKey.json'
});

// -----------------------------
// 3. Express App Setup
// -----------------------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Root endpoint
app.get("/", (req, res) => {
  res.send("Loan Training Bot is Running!");
});

console.log("📧 EMAIL_USER:", process.env.EMAIL_USER);
console.log("🔑 EMAIL_PASSWORD:", process.env.EMAIL_PASSWORD ? "Set" : "Not Set");

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: "smtp.mail.me.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  logger: true,
  debug: true,
});

// Function to log errors to a file
function logErrorToFile(error, callId) {
  const timestamp = new Date().toISOString();
  const errorMessage = `[${timestamp}] ❌ ERROR SENDING EMAIL (Call ID: ${callId}):\n${error.stack || error.message}\n\n`;
  console.error(errorMessage);
  fs.appendFile("email_errors.log", errorMessage, (err) => {
    if (err) console.error("❌ Failed to write error to log file:", err);
  });
}

// -----------------------------
// Helper Functions
// -----------------------------
// Computes call duration (if needed later)
function computeCallDuration(callId) {
  if (conversationLogs[callId] && conversationLogs[callId].startTime) {
    const startTime = conversationLogs[callId].startTime;
    return Math.floor((Date.now() - startTime) / 1000);
  } else {
    return "N/A";
  }
}

// Check if the conversation includes a user introduction.
function checkIfIntroduced(conversation) {
  const transcript = conversation.map(entry => entry.content.toLowerCase()).join(" ");
  return (transcript.includes("my name is") || transcript.includes("i'm ") || transcript.includes("i am ")) ? "Yes" : "No";
}

// Check if there's any mention of recording.
function checkIfCallRecordingMentioned(conversation) {
  const transcript = conversation.map(entry => entry.content.toLowerCase()).join(" ");
  return transcript.includes("record") ? "Yes" : "No";
}

// Check for a "million dollar minute" in the conversation.
function checkMillionDollarMinute(conversation) {
  const transcript = conversation.map(entry => entry.content.toLowerCase()).join(" ");
  const hasCompanyIntro = transcript.includes("CrossCountry Mortgage") || transcript.includes("we are");
  const hasSelfIntro = transcript.includes("my name is");
  const benefitsKeywords = ["payment", "cash", "tax", "term", "deferal"];
  const hasBenefits = benefitsKeywords.some(keyword => transcript.includes(keyword));
  const assuranceKeywords = ["making the right move", "making the right choice", "right decision"];
  const hasAssurance = assuranceKeywords.some(keyword => transcript.includes(keyword));
  return (hasCompanyIntro && hasSelfIntro && hasBenefits && hasAssurance) ? "Yes" : "No";
}

// Create a call recording using Twilio.
async function createCallRecording(callId) {
  try {
    const recording = await twilioClient.calls(callId).recordings.create();
    console.log("Recording created, SID:", recording.sid);
    return recording;
  } catch (error) {
    console.error("Error creating call recording:", error.message);
    return null;
  }
}

// Basic transcription function using Google Speech-to-Text.
async function transcribeSpeech(audioUrl) {
  console.log("🎙️ Processing speech-to-text...");
  try {
    const audio = { uri: audioUrl };
    const config = { encoding: "LINEAR16", languageCode: "en-US" };
    const request = { audio, config };
    const [response] = await speechClient.recognize(request);
    const transcription = response.results.map(result => result.alternatives[0].transcript).join(" ");
    console.log("📝 Recognized Speech:", transcription);
    return transcription;
  } catch (error) {
    console.error("❌ Speech-to-Text Error:", error);
    return null;
  }
}

// New function: Use transcribed text to call processUserQuery.
async function processAudioQuery(audioUrl, callId, systemPrompt) {
  let userQuery = await transcribeSpeech(audioUrl);
  if (!userQuery || !userQuery.trim()) {
    userQuery = "I'm sorry, I didn't catch that. Could you please repeat?";
  }
  return await processUserQuery(userQuery, callId, systemPrompt);
}

// -----------------------------
// OpenAI Query Processing
// -----------------------------
async function processUserQuery(userQuery, callId, systemPrompt) {
  // 1. Check the cache first
  const cachedResponse = await redisClient.get(userQuery);
  if (cachedResponse) {
    console.log("⏩ Returning cached response for:", userQuery);
    return cachedResponse;
  }

  // 2. If no cache hit, call OpenAI
  let responseText = "I'm sorry, I didn't catch that.";
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userQuery }],
      max_tokens: 60,
      temperature: 0.6,
    });
    if (response.choices && response.choices.length > 0) {
      responseText = response.choices[0].message.content.trim();
    }
    
    // 3. Store the new response in Redis without an expiration
    await redisClient.set(userQuery, responseText);
    
  } catch (error) {
    console.error("OpenAI Error:", error.message);
  }

  return responseText;
}



// -----------------------------
// Sentiment Analysis Function
// -----------------------------
async function analyzeSentiment(conversationTranscript) {
  const sentimentPrompt = `
You are an expert sentiment analyst. Analyze the following conversation transcript between a user and an assistant.
For the USER, evaluate and assign a score from 1 to 100 for:
- Enthusiasm
- Hesitation
- Persuasion
- Confidence

Do the same for the ASSISTANT.

Return your analysis strictly in the following JSON format:
{
  "User": {
    "Enthusiasm": <score>,
    "Hesitation": <score>,
    "Persuasion": <score>,
    "Confidence": <score>
  },
  "Assistant": {
    "Enthusiasm": <score>,
    "Hesitation": <score>,
    "Persuasion": <score>,
    "Confidence": <score>
  }
}

Transcript:
${conversationTranscript}
  `;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "system", content: sentimentPrompt }],
      max_tokens: 55,
      temperature: 0.6,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Sentiment Analysis Error:", error.message);
    return null;
  }
}

// -----------------------------
// API Endpoint for Twilio Voice Calls
// -----------------------------
app.post("/voice", async (req, res) => {
  // Get the called number from the Twilio request
  const calledNumber = req.body.To;
  
  // Determine mapping: prompt and voice based on called number
  const mapping = phoneMapping[calledNumber] || defaultMapping;
  const systemPrompt = mapping.prompt;
  const voice = mapping.voice;


  const twiml = new twilio.twiml.VoiceResponse();
  const callId = req.body.CallSid;
  if (!conversationLogs[callId]) {
    conversationLogs[callId] = [];
  }
  let responseText = "";
  if (req.body.RecordingUrl) {
    responseText = await processAudioQuery(req.body.RecordingUrl, callId, systemPrompt);
  } else {
    const userQuery = req.body.SpeechResult || req.body.Body || "";
    if (userQuery.trim()) {
      conversationLogs[callId].push({ role: "user", content: userQuery });
    }
    console.log(`📞 Call ID: ${callId} - User Query: "${userQuery}"`);
   // If no speech detected, prompt the user again
if (!userQuery.trim()) {
	const introSSML = `<speak><prosody rate="medium" pitch="default">Hello, who is this calling?</prosody></speak>`;
	twiml.say({ voice: voice, language: "en-US" }, introSSML);
	twiml.gather({
		input: "speech",
		action: "/voice",
		timeout: 30,
		speechTimeout: "auto",
  });
  return res.type("text/xml").send(twiml.toString());
}
    responseText = await processUserQuery(userQuery, callId, systemPrompt);
  }
  const conversationSSML = `<speak><prosody rate="medium" pitch="default">${responseText}</prosody></speak>`;
  twiml.say({ voice: "Polly.Joanna", language: "en-US" }, conversationSSML);
  twiml.gather({
    input: "speech",
    action: "/voice",
    timeout: 90,
    speechTimeout: "auto",
    language: "en-US",
    hints: "refinance, mortgage, cash-out, rate, interest, borrower, CrossCountry Mortgage, LendingTree, Your Inquiry, Responding To your Inquiry, my name is, calling, nobody, no-one"
  });
  return res.type("text/xml").send(twiml.toString());
});

// -----------------------------
// Send Call Transcript via Email (Before Deleting Logs)
// -----------------------------
async function sendEmail(transcript, callId, introduced, recordingMentioned, millionDollarMinute, sentimentReport, recordingInfo) {
  console.log(`📧 Preparing to send email for Call ID: ${callId}`);
  if (!transcript) {
    console.error("❌ ERROR: Transcript is empty!");
    return;
  }
  console.log("📡 Attempting to connect to SMTP...");
  console.log("📧 EMAIL_USER:", process.env.EMAIL_USER);
  console.log("🔑 EMAIL_PASSWORD:", process.env.EMAIL_PASSWORD ? "Set" : "Not Set");

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: ["berger@ccm.com","corey.urso@ccm.com","ryan.anderson@ccm.com", "giorgio.gonzalez@ccm.com","donald.jacobus@ccm.com","matthew.kleiner@ccm.com"],
    subject: `Loan Training Bot Call Transcript - Call ID: ${callId}`,
    text: `Recording Info: ${recordingInfo}
User Introduced: ${introduced}
Call Recording Mentioned: ${recordingMentioned}
Million Dollar Minute: ${millionDollarMinute}
Sentiment Report:
${sentimentReport}

Call Transcript:
${transcript}`,
    html: `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 2.2; color: #333; }
            h1 { color: #0055aa; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 4px; }
            p { margin: 0.5em 0; }
            hr { margin: 1em 0; }
          </style>
        </head>
        <body>
          <h1>Call Transcript</h1>
          <p><strong>Call ID:</strong> ${callId}</p>
          <p><strong>Recording Info:</strong> ${recordingInfo}</p>
          <p><strong>User Introduced:</strong> ${introduced}</p>
          <p><strong>Call Recording Mentioned:</strong> ${recordingMentioned}</p>
          <p><strong>Million Dollar Minute:</strong> ${millionDollarMinute}</p>
          <p><strong>Sentiment Report:</strong></p>
          <pre>${sentimentReport}</pre>
          <hr>
          <pre>${transcript}</pre>
        </body>
      </html>
    `,
  };

  try {
    console.log("📤 Sending email...");
    const response = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully! Response: ${response.response}`);
  } catch (error) {
    console.error("❌ Nodemailer Email Error:", error);
  }
}

app.post("/end-call", async (req, res) => {
  const callId = req.body.CallSid;
  console.log(`📞 Processing end-of-call for Call ID: ${callId}`);
  if (conversationLogs[callId]) {
    console.log(`✅ Conversation log exists for Call ID: ${callId}`);
    
    // Create a call recording using the dynamic callId
    const recording = await createCallRecording(callId);
    const recordingInfo = recording ? `Recording SID: ${recording.sid}` : "No recording created";
    
    // Convert logs to transcript text
    const transcript = conversationLogs[callId]
      .map(entry => `${entry.role}: ${entry.content}`)
      .join("\n\n");
    console.log(`📝 Transcript for Call ID ${callId}: ${transcript}`);
    
    // Additional flags extracted from the conversation log
    const introduced = checkIfIntroduced(conversationLogs[callId]);
    const recordingMentioned = checkIfCallRecordingMentioned(conversationLogs[callId]);
    const millionDollarMinute = checkMillionDollarMinute(conversationLogs[callId]);
    
    // Perform sentiment analysis on the transcript
    const sentimentReport = await analyzeSentiment(transcript);

    // Build the email body with all details before the transcript.
    const emailBody = `
Recording Info: ${recordingInfo}

User Introduced: ${introduced}
Call Recording Mentioned: ${recordingMentioned}
Million Dollar Minute: ${millionDollarMinute}

Sentiment Report:
${sentimentReport}

Call Transcript:
${transcript}
    `;
    console.log(`📝 Email Body for Call ID ${callId}: ${emailBody}`);

    // Send Email BEFORE deleting logs
    try {
      console.log("📤 Attempting to send email...");
      await sendEmail(emailBody, callId, introduced, recordingMentioned, millionDollarMinute, sentimentReport, recordingInfo);
      console.log("✅ Email function executed!");
    } catch (error) {
      console.error("❌ Error in sendEmail function:", error);
    }
    console.log(`🗑️ Deleting conversation log for Call ID: ${callId}`);
    delete conversationLogs[callId];
  } else {
    console.log(`⚠️ No logs found for Call ID: ${callId}`);
  }
  res.sendStatus(200);
});

// -----------------------------
// Start the Server
// -----------------------------
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection:", reason);
});
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Voicebot server is running on port ${PORT}`);
});

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
const systemPrompt = fs.readFileSync("prompt.txt", "utf8");

// Initialize Google TTS & Speech-to-Text
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

// ✅ Create reusable transporter
const transporter = nodemailer.createTransport({
   	host: "smtp.mail.me.com",
	port: 587,
	secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
    },
    logger: true,  // ✅ Logs all email sending events
    debug: true    // ✅ Shows SMTP interactions
});

// ✅ Function to Log Errors to a File

function logErrorToFile(error, callId) {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ❌ ERROR SENDING EMAIL (Call ID: ${callId}):\n${error.stack || error.message}\n\n`;

    console.error(errorMessage);

    fs.appendFile("email_errors.log", errorMessage, (err) => {
        if (err) console.error("❌ Failed to write error to log file:", err);
    });
}

// Create a client using your service account key
// Basic transcription function (using Google Speech-to-Text with a public audio URL)
async function transcribeSpeech(audioUrl) {
  console.log("🎙️ Processing speech-to-text...");

  try {
    const audio = { uri: audioUrl };
    const config = {
      encoding: "LINEAR16",
      languageCode: "en-US",
    };
    const request = { audio, config };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join(" ");
    console.log("📝 Recognized Speech:", transcription);
    return transcription;
  } catch (error) {
    console.error("❌ Speech-to-Text Error:", error);
    return null;
  }
}

// New function that integrates transcription with your existing processUserQuery function
// Your existing function remains unchanged:
async function processUserQuery(userQuery, callId, systemPrompt) {
  let responseText = "I'm sorry I didn't hear you; what was that you said?";

  // Ensure conversation log is initialized
  if (!conversationLogs[callId]) {
    conversationLogs[callId] = [];
  }

  // Append past conversation history
  const messages = [
    { role: "system", content: systemPrompt || "You are a real mortgage customer applying for a refinance. You want to save money by consolidating debt. YOU ARE not an assistant; you are getting the assistance from the caller who is talking to you." },
    ...conversationLogs[callId], // Add conversation history
    { role: "user", content: userQuery },
  ];

  try {
    console.log("📤 OpenAI Request:", JSON.stringify(messages, null, 2));

    const response = await openai.chat.completions.create({
      model: "gpt-4", // Or use "gpt-3.5-turbo" if preferred
      messages,
      max_tokens: 60,
      temperature: 0.7,
    });

    if (response.choices && response.choices.length > 0) {
      responseText = response.choices[0].message.content.trim();
    } else {
      console.error("⚠️ OpenAI returned an empty response.");
    }

    // Store assistant response in conversation history
    conversationLogs[callId].push({ role: "assistant", content: responseText });
  } catch (error) {
    console.error("❌ OpenAI Error:", error.message);
  }

  return responseText;
}

// New function: Transcribe the audio and then process the query
async function transcribeSpeech(audioUrl) {
  console.log("🎙️ Processing speech-to-text...");

  try {
    // Here we're using a public audio URL (assumes Google can access it)
    const audio = { uri: audioUrl };
    const config = {
      encoding: "LINEAR16",
      languageCode: "en-US",
    };
    const request = { audio, config };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join(" ");
    console.log("📝 Recognized Speech:", transcription);
    return transcription;
  } catch (error) {
    console.error("❌ Speech-to-Text Error:", error);
    return null;
  }
}

// New function: Use transcribed text to call processUserQuery
async function processAudioQuery(audioUrl, callId, systemPrompt) {
  // First, transcribe the audio
  let userQuery = await transcribeSpeech(audioUrl);
  // If transcription fails, use a default message
  if (!userQuery || !userQuery.trim()) {
    userQuery = "I'm sorry, I didn't catch that. Could you please repeat?";
  }
  // Now, call your existing processUserQuery function using the transcribed text
  return await processUserQuery(userQuery, callId, systemPrompt);
}


// -----------------------------
// 5. API Endpoint for Twilio Voice Calls
// -----------------------------

app.post("/voice", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const callId = req.body.CallSid; // Unique ID for the call
 
  // Ensure conversation log exists
  if (!conversationLogs[callId]) {
    conversationLogs[callId] = [];
  }

  let responseText = "";
  
  // Check if an audio recording URL is provided
  if (req.body.RecordingUrl) {
    // Use Google Speech-to-Text to transcribe audio, then process the query
    responseText = await processAudioQuery(req.body.RecordingUrl, callId, systemPrompt);
  } else {
    // Use text-based input
    const userQuery = req.body.SpeechResult || req.body.Body || "";
    
    // Log user input if present
    if (userQuery.trim()) {
      conversationLogs[callId].push({ role: "user", content: userQuery });
    }
    
    console.log(`📞 Call ID: ${callId} - User Query: "${userQuery}"`);
    
    // If no speech detected, prompt the user again
    if (!userQuery.trim()) {
      const introSSML = `<speak><prosody rate="medium" pitch="default">Hello, who is this calling?</prosody></speak>`;
      twiml.say({ voice: "Polly.Joanna", language: "en-US" }, introSSML);
      twiml.gather({
        input: "speech",
        action: "/voice",
        timeout: 30,
        speechTimeout: "auto",
        language: "en-US",
        hints: "refinance, mortgage, cash-out, rate, interest, borrower, CrossCountry Mortgage, LendingTree, Your Inquiry, Responding To your Inquiry, my name is, calling, nobody, no-one"
      });
      return res.type("text/xml").send(twiml.toString());
    }
    
    responseText = await processUserQuery(userQuery, callId, systemPrompt);
  }

  // Speak response using SSML
  const conversationSSML = `<speak><prosody rate="medium" pitch="default">${responseText}</prosody></speak>`;
  twiml.say({ voice: "Polly.Joanna", language: "en-US" }, conversationSSML);

  // Keep conversation going
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


// 6.1 Send Call Transcript via Email (Before Deleting Logs)
// -----------------------------

// ✅ Main Email Sending Function
async function sendEmail(transcript, callId) {
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
    to: ["berger@ccm.com"],
    subject: `Loan Training Bot Call Transcript - Call ID: ${callId}`,
    text: `Transcript of the call:\n\n${transcript}`,  // fallback plain text version
    html: `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            h1 { color: #0055aa; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Call Transcript</h1>
          <p><strong>Call ID:</strong> ${callId}</p>
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

module.exports = { sendEmail };

// -----------------------------
// 6.2 End Call & Cleanup Memory
// -----------------------------
app.post("/end-call", async (req, res) => {
    const callId = req.body.CallSid;
    console.log(`📞 Processing end-of-call for Call ID: ${callId}`);

    if (conversationLogs[callId]) {
        console.log(`✅ Conversation log exists for Call ID: ${callId}`);
        
        // ✅ Convert logs to string for email
        const transcript = JSON.stringify(conversationLogs[callId], null, 2);
        console.log(`📝 Transcript for Call ID ${callId}: ${transcript}`);

        // ✅ Ensure environment variables exist
        console.log("📧 EMAIL_USER:", process.env.EMAIL_USER);
        console.log("🔑 EMAIL_PASSWORD:", process.env.EMAIL_PASSWORD ? "Set" : "Not Set");

        // ✅ Send Email BEFORE deleting logs
        try {
            console.log("📤 Attempting to send email...");
            await sendEmail(transcript, callId);
            console.log("✅ Email function executed!");
        } catch (error) {
            console.error("❌ Error in sendEmail function:", error);
        }

        // ✅ Log before deleting conversation
        console.log(`🗑️ Deleting conversation log for Call ID: ${callId}`);
        delete conversationLogs[callId];
    } else {
        console.log(`⚠️ No logs found for Call ID: ${callId}`);
    }

    res.sendStatus(200);
});

// -----------------------------
// 7. Start the Server
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
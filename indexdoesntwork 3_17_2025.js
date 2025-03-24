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
const systemPromptDefault = fs.readFileSync("prompt.txt", "utf8");


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


// -----------------------------
// 4. OpenAI Query Processing
// -----------------------------
async function processUserQuery(userQuery, callId, systemPrompt) {
  let responseText = "I'm sorry i didnt hear you what was that you said?";

  // Ensure conversation log is initialized
  if (!conversationLogs[callId]) {
    conversationLogs[callId] = [];
  }

  // Append past conversation history
  const messages = [
    { role: "system", content: systemPrompt || "You are a real mortgage customer applying for a refinance. You want to save money by consolidating debt. YOU ARE not an asistant you are getting the assistance from the caller who is talking to you. " },
    ...conversationLogs[callId], // Add conversation history
    { role: "user", content: userQuery },
  ];

  try {
    console.log("📤 OpenAI Request:", JSON.stringify(messages, null, 2));

    const response = await openai.chat.completions.create({
    model: "gpt-4",  // Change from "GPT-4o" to "gpt-4" or "gpt-3.5-turbo"
    messages,
    max_tokens: 100, // ⏩ Limit response length for faster replies
    temperature: 0.7, 
});


    if (response.choices && response.choices.length > 0) {
      responseText = response.choices[0].message.content.trim();
    } else {
      console.error("⚠️ OpenAI returned an empty response.");
    }

    // ✅ Store assistant response in conversation history
    conversationLogs[callId].push({ role: "customer", content: responseText });

  } catch (error) {
    console.error("❌ OpenAI Error:", error.message);
  }

  return responseText;
}

// -----------------------------
// 5. API Endpoint for Twilio Voice Calls
// -----------------------------

app.post("/voice", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const userQuery = req.body.SpeechResult || req.body.Body || "";
  const callId = req.body.CallSid; // Unique ID for the call

  // Ensure conversation log exists
  if (!conversationLogs[callId]) {
    conversationLogs[callId] = [];
  }

  // Log user input
  if (userQuery.trim()) {
    conversationLogs[callId].push({ role: "user", content: userQuery });
  }

  console.log(`📞 Call ID: ${callId} - User Query: "${userQuery}"`);

  // If no speech detected, prompt the user again
  if (!userQuery.trim()) {
    twiml.say({ voice: "Polly.Joanna", language: "en-US", rate: "medium", pitch: "high" }, "Hello who is this calling?");
    twiml.gather({
      input: "speech",
      action: "/voice",
      timeout: 30,
      speechTimeout: "auto",
    });
    return res.type("text/xml").send(twiml.toString());
  }

  // Get response from OpenAI with memory reference
  let responseText = await processUserQuery(userQuery, callId, systemPromptDefault);

  // Speak response
  twiml.say({ voice: "Polly.Joanna", language: "en-US", rate: "medium", pitch: "high" }, responseText);

  // Keep conversation going
  twiml.gather({
    input: "speech",
    action: "/voice",
    timeout: 90,
    speechTimeout: "auto",
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
        text: `Transcript of the call:\n\n${transcript}`,
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
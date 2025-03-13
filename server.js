const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
const axios = require("axios");
const url = require('url'); 
dotenv.config();
dotenv.config({ path: `.env.local`, override: true });

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

const { Groq } = require("groq-sdk");
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

console.log("Deepgram API key:", process.env.DEEPGRAM_API_KEY ? `Set: ${process.env.DEEPGRAM_API_KEY}` : "Not set");
console.log("Groq API key:", process.env.GROQ_API_KEY ? `Set: ${process.env.GROQ_API_KEY}` : "Not set");
console.log("Simli API key:", process.env.NEXT_PUBLIC_SIMLI_API_KEY ? `Set: ${process.env.NEXT_PUBLIC_SIMLI_API_KEY}` : "Not set");

// Connection manager to keep track of active connections
const connections = new Map();

let VoiceId = "aura-stella-en";

app.post('/start-conversation', (req, res) => {
  const { initialPrompt, model, voiceId, language } = req.body;
  VoiceId = voiceId;
  if (!initialPrompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const connectionId = Date.now().toString();
  connections.set(connectionId, { 
    initialPrompt,
    model,
    voiceId,
    language,
    currentStream: null
  });
  res.json({ connectionId, message: 'Conversation started. Connect to WebSocket to continue.' });
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname, query } = url.parse(request.url, true);
  
  if (pathname === '/ws') {
    const connectionId = query.connectionId;
    if (!connectionId || !connections.has(connectionId)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const connection = connections.get(connectionId);
      console.log(`WebSocket: Client connected (ID: ${connectionId})`);
      setupWebSocket(ws, connection.initialPrompt, connection.model, connection.language, connectionId);
    });
  } else {
    socket.destroy();
  }
});

const setupWebSocket = (ws, initialPrompt, model, language, connectionId) => {
  let is_finals = [];
  let audioQueue = [];
  let keepAlive;

  const deepgram = deepgramClient.listen.live({
    model: model,
    language: language,
    smart_format: true,
    no_delay: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000
  });

  deepgram.addListener(LiveTranscriptionEvents.Open, () => {
    console.log(`Deepgram STT: Connected (ID: ${connectionId})`);
    while (audioQueue.length > 0) {
      const audioData = audioQueue.shift();
      deepgram.send(audioData);
    }
  });

  deepgram.addListener(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript !== "") {
      if (data.is_final) {
        is_finals.push(transcript);
        if (data.speech_final) {
          const utterance = is_finals.join(" ");
          is_finals = [];
          console.log(`Deepgram STT: [Speech Final] ${utterance} (ID: ${connectionId})`);

          // Get the current connection
          const connection = connections.get(connectionId);
          if (connection?.currentStream?.controller) {
            console.log('Interrupting current stream');
            try {
              connection.currentStream.controller.abort();
            } catch (error) {
              console.error('Error aborting stream:', error);
            }
            connection.currentStream = null;
          }

          ws.send(JSON.stringify({ type: 'interrupt' }));
          await promptLLM(ws, initialPrompt, utterance, connectionId);
        } else {
          console.log(`Deepgram STT: [Is Final] ${transcript} (ID: ${connectionId})`);
        }
      } else {
        console.log(`Deepgram STT: [Interim Result] ${transcript} (ID: ${connectionId})`);
      }
    }
  });

  deepgram.addListener(LiveTranscriptionEvents.Error, (error) => {
    console.error(`Deepgram STT error (ID: ${connectionId}):`, error);
  });

  deepgram.addListener(LiveTranscriptionEvents.Close, () => {
    console.log(`Deepgram STT: Disconnected (ID: ${connectionId})`);
    clearInterval(keepAlive);
    deepgram.removeAllListeners();
  });

  ws.on("message", async (message) => {
    try {
      console.log(`WebSocket: Client data received (ID: ${connectionId})`, typeof message, message.length, "bytes");

      if (deepgram.getReadyState() === 1) {
        await deepgram.send(message);
      } else {
        console.log(`WebSocket: Data queued for Deepgram. Current state: ${deepgram.getReadyState()} (ID: ${connectionId})`);
        audioQueue.push(message);
      }
    } catch (error) {
      console.error(`Error processing WebSocket message (ID: ${connectionId}):`, error);
    }
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error (ID: ${connectionId}):`, error);
  });

  ws.on("close", () => {
    console.log(`WebSocket: Client disconnected (ID: ${connectionId})`);
    clearInterval(keepAlive);
    deepgram.removeAllListeners();
    
    // Clean up any active streams
    const connection = connections.get(connectionId);
    if (connection?.currentStream?.controller) {
      try {
        connection.currentStream.controller.abort();
      } catch (error) {
        console.error('Error aborting stream on close:', error);
      }
    }
    connections.delete(connectionId);
  });

  keepAlive = setInterval(() => {
    try {
      deepgram.keepAlive();
    } catch (error) {
      console.error(`Error in keepAlive (ID: ${connectionId}):`, error);
    }
  }, 10 * 1000);

  connections.set(connectionId, { 
    ...connections.get(connectionId), 
    ws, 
    deepgram,
    currentStream: null 
  });
};

async function startDeepgramTTS(ws, text, connectionId) {
  if (!text.trim()) {
    console.log(`Skipping empty TTS text (ID: ${connectionId})`);
    return;
  }

  try {
    console.log(`Starting TTS for text: "${text}" (ID: ${connectionId})`);

    const response = await axios({
      method: 'POST',
      url: `https://api.deepgram.com/v1/speak?model=${VoiceId}&encoding=linear16&sample_rate=16000`,
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({ text }),
      responseType: 'arraybuffer'
    });

    // Check if the response contains an error message
    if (response.headers['content-type']?.includes('application/json')) {
      const errorText = Buffer.from(response.data).toString('utf8');
      console.error(`Deepgram TTS API error (ID: ${connectionId}):`, errorText);
      return;
    }

    // Convert the response data to Uint8Array
    const audioData = new Uint8Array(response.data);
    
    const chunkSize = 2048; // Keep chunk size consistent with audio frame size
    const chunks = [];
    const CHUNKS_TO_SKIP = 1; // Number of initial chunks to skip
    
    // Pre-process audio chunks
    for (let i = 0; i < audioData.length; i += chunkSize) {
      const chunk = audioData.slice(i, Math.min(i + chunkSize, audioData.length));
      chunks.push(chunk);
    }

    // Skip the first 4 chunks and start from the 5th chunk
    for (let i = CHUNKS_TO_SKIP; i < chunks.length; i++) {
      if (!connections.has(connectionId)) {
        console.log(`Deepgram TTS: Connection ${connectionId} no longer exists`);
        break;
      }

      try {
        // Add a small delay between chunks for smoother playback
        await new Promise(resolve => setTimeout(resolve, 10));
        ws.send(chunks[i], { binary: true });
      } catch (error) {
        console.error(`Error sending audio chunk (ID: ${connectionId}):`, error);
      }
    }

  } catch (error) {
    if (error.response?.data) {
      const errorText = Buffer.from(error.response.data).toString('utf8');
      console.error(`Deepgram TTS API error (ID: ${connectionId}):`, errorText);
    } else {
      console.error(`Error in text-to-speech (ID: ${connectionId}):`, error);
      console.error('Error stack:', error.stack);
    }
  }
}

async function promptLLM(ws, initialPrompt, prompt, connectionId) {
  if (!prompt.trim()) {
    console.log(`Skipping empty prompt (ID: ${connectionId})`);
    return;
  }

  try {
    console.log(`Processing prompt: "${prompt}" (ID: ${connectionId})`);
    
    const controller = new AbortController();
    const stream = await groq.chat.completions.create({
      model: "mixtral-8x7b-32768",
      messages: [
        {
          role: 'assistant',
          content: initialPrompt
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 1,
      max_tokens: 1000,
      top_p: 1,
      stream: true,
    }, { signal: controller.signal });

    const connection = connections.get(connectionId);
    if (connection) {
      connection.currentStream = { stream, controller };
    }

    let textBuffer = '';
    const CHUNK_THRESHOLD = 60;

    try {
      for await (const chunk of stream) {
        if (!connections.has(connectionId)) {
          console.log(`LLM process stopped: Connection ${connectionId} no longer exists`);
          break;
        }

        const chunkMessage = chunk.choices[0]?.delta?.content || '';
        textBuffer += chunkMessage;

        ws.send(JSON.stringify({ type: 'text', content: chunkMessage }));

        if (textBuffer.length >= CHUNK_THRESHOLD || /[.!?]/.test(chunkMessage)) {
          if (textBuffer.trim().length > 0) {
            await startDeepgramTTS(ws, textBuffer.trim(), connectionId);
            textBuffer = '';
          }
        }
      }

      if (textBuffer.trim().length > 0) {
        await startDeepgramTTS(ws, textBuffer.trim(), connectionId);
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Groq stream aborted due to new speech');
      } else {
        throw error;
      }
    }

    if (connection) {
      connection.currentStream = null;
    }

  } catch (error) {
    console.error(`Error in promptLLM (ID: ${connectionId}):`, error);
    ws.send(JSON.stringify({ 
      type: 'error', 
      content: 'An error occurred while processing your request.' 
    }));
  }
}

const port = 8080;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
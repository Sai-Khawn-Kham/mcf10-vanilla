// --- Gemini API Constants and Utilities ---
const apiKey = "AIzaSyBIhznDqp7GqnK4X7FEWqn2-oUSNHTnYJI"; // API key is provided by the canvas environment
const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
const ttsApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

// Global variables for DOM elements (initialized in window.onload)
let ttsTextSpan;
let ttsIconContainer;
let mobileMenuIconContainer;
let audioInstance = null; // Store the currently playing audio element

// Helper for Exponential Backoff (Handles retries for API calls)
async function fetchWithExponentialBackoff(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Server error: ${response.statusText}`);
      } else {
        // For client errors (4xx other than 429), just return the response
        return response;
      }
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error("Fetch failed after all retries:", error);
        throw error;
      }
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// --- TTS Helper Functions (PCM to WAV Conversion) ---
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function pcmToWav(pcm16, sampleRate) {
  const numChannels = 1;
  const numSamples = pcm16.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF identifier 'RIFF'
  writeString(view, offset, "RIFF");
  offset += 4;
  // file length
  view.setUint32(offset, 36 + numSamples * 2, true);
  offset += 4;
  // RIFF type 'WAVE'
  writeString(view, offset, "WAVE");
  offset += 4;
  // format chunk identifier 'fmt '
  writeString(view, offset, "fmt ");
  offset += 4;
  // format chunk length
  view.setUint32(offset, 16, true);
  offset += 4;
  // sample format (1 for PCM)
  view.setUint16(offset, 1, true);
  offset += 2;
  // number of channels
  view.setUint16(offset, numChannels, true);
  offset += 2;
  // sample rate
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  // byte rate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint32(offset, sampleRate * numChannels * 2, true);
  offset += 4;
  // block align (NumChannels * BitsPerSample/8)
  view.setUint16(offset, numChannels * 2, true);
  offset += 2;
  // bits per sample
  view.setUint16(offset, 16, true);
  offset += 2;
  // data chunk identifier 'data'
  writeString(view, offset, "data");
  offset += 4;
  // data chunk length (NumSamples * NumChannels * BitsPerSample/8)
  view.setUint32(offset, numSamples * 2, true);
  offset += 4;

  // Write PCM data
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(offset, pcm16[i], true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

// --- Icon Replacement Helper (Fix for lucide.replace issue) ---
function updateIcon(container, iconName, classes = "w-4 h-4") {
  if (!container || typeof lucide === "undefined") return;
  // 1. Clear the container (removes old SVG)
  container.innerHTML = "";
  // 2. Insert the new <i> tag with the desired data-lucide attribute
  container.innerHTML = `<i data-lucide="${iconName}" class="${classes}"></i>`;
  // 3. Re-run createIcons on the container to replace the <i> with the SVG
  lucide.createIcons({ element: container });
}

// --- Feature 1: Project Brainstormer Logic (Text Generation) ---
async function handleBrainstorm() {
  const inputElement = document.getElementById("brainstorm-input");
  const resultsDiv = document.getElementById("brainstorm-results");
  const loadingIndicator = document.getElementById("brainstorm-loading");
  const errorIndicator = document.getElementById("brainstorm-error");
  const button = document.getElementById("brainstorm-button");

  const goal = inputElement.value.trim();
  if (!goal) return;

  // UI state management
  button.disabled = true;
  loadingIndicator.classList.remove("hidden");
  errorIndicator.classList.add("hidden");
  resultsDiv.innerHTML = "";

  try {
    const systemPrompt =
      "You are a senior Solutions Architect at a top-tier tech consultancy. Your task is to transform a high-level business goal into three distinct, structured project proposals suitable for client presentation. Each proposal must include a compelling title, a realistic tech stack, and three precise, high-impact key deliverables. Respond strictly as a JSON array.";
    const userQuery = `The client's primary business goal is: "${goal}". Generate 3 distinct project ideas.`;

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: {
                type: "STRING",
                description:
                  "A compelling, client-facing title for the project.",
              },
              techStack: {
                type: "STRING",
                description:
                  "A concise list of main technologies (e.g., 'React, Python/Django, PostgreSQL, AWS Lambda').",
              },
              deliverables: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "Exactly three specific, measurable deliverables.",
              },
            },
            propertyOrdering: ["title", "techStack", "deliverables"],
          },
        },
      },
    };

    const response = await fetchWithExponentialBackoff(textApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const result = await response.json();
    const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!jsonText)
      throw new Error("Received empty or malformed response from API.");

    const proposals = JSON.parse(jsonText);

    // Render Results
    let html = "";
    proposals.forEach((p, index) => {
      html += `
                        <div class="bg-dark-bg p-6 rounded-xl shadow-lg border border-primary/50">
                            <h3 class="text-2xl font-bold text-accent mb-3">#${
                              index + 1
                            }: ${p.title}</h3>
                            <div class="space-y-4">
                                <div>
                                    <p class="font-semibold text-white">Technology Stack:</p>
                                    <p class="text-sm text-gray-400">${
                                      p.techStack
                                    }</p>
                                </div>
                                <div>
                                    <p class="font-semibold text-white">Key Deliverables:</p>
                                    <ul class="list-disc list-inside text-sm text-gray-400 pl-4 space-y-1">
                                        ${p.deliverables
                                          .map((d) => `<li>${d}</li>`)
                                          .join("")}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    `;
    });
    resultsDiv.innerHTML = html;
  } catch (e) {
    console.error("Brainstorming failed:", e);
    errorIndicator.classList.remove("hidden");
  } finally {
    button.disabled = false;
    loadingIndicator.classList.add("hidden");
  }
}

// --- Feature 2: Service TTS Logic (Audio Generation) ---

// Helper function to update the TTS icon safely (Fix for lucide.replace issue)
function updateTtsIcon(iconName, classes = "w-4 h-4") {
  updateIcon(ttsIconContainer, iconName, classes);
}

async function handleTTS() {
  const button = document.getElementById("tts-button");
  const summaryTextElement = document.getElementById("service-summary");
  const textToSpeak = summaryTextElement.textContent.trim();

  if (audioInstance) {
    // If audio is playing, stop and remove it
    audioInstance.pause();
    audioInstance.currentTime = 0;
    audioInstance = null;
    updateTtsIcon("volume-2"); // FIXED: Used updateIcon helper
    ttsTextSpan.textContent = "Listen to Summary ✨"; // FIXED: Used ttsTextSpan
    return;
  }

  button.disabled = true;
  ttsTextSpan.textContent = "Generating..."; // FIXED: Used ttsTextSpan
  updateTtsIcon("loader-2", "w-4 h-4 animate-spin"); // FIXED: Used updateIcon helper

  try {
    // We will send the text from the paragraph below the Expertise heading
    const userQuery = `Speak the following text in a clear, informative voice using the 'Charon' voice: "${textToSpeak}"`;

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Charon" },
          },
        },
      },
      model: "gemini-2.5-flash-preview-tts",
    };

    const response = await fetchWithExponentialBackoff(ttsApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const result = await response.json();
    const part = result?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (!audioData || !mimeType || !mimeType.startsWith("audio/L16")) {
      throw new Error("Invalid audio response format. MimeType:" + mimeType);
    }

    // Extract sample rate from MIME type (e.g., audio/L16;rate=24000)
    const rateMatch = mimeType.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

    // Decode base64 and convert PCM to WAV blob
    const pcmData = base64ToArrayBuffer(audioData);
    const pcm16 = new Int16Array(pcmData);
    const wavBlob = pcmToWav(pcm16, sampleRate);
    const audioUrl = URL.createObjectURL(wavBlob);

    // Play the audio
    audioInstance = new Audio(audioUrl);
    audioInstance.play();

    // Update UI to show playing/stop state
    updateTtsIcon("volume-x"); // FIXED: Used updateIcon helper
    ttsTextSpan.textContent = "Stop Listening"; // FIXED: Used ttsTextSpan

    // Cleanup when audio finishes
    audioInstance.onended = () => {
      audioInstance = null;
      updateTtsIcon("volume-2"); // FIXED: Used updateIcon helper
      ttsTextSpan.textContent = "Listen to Summary ✨"; // FIXED: Used ttsTextSpan
    };
  } catch (e) {
    console.error("TTS failed:", e);
    // Simple visual feedback for error
    ttsTextSpan.textContent = "Error!"; // FIXED: Used ttsTextSpan
    setTimeout(() => {
      ttsTextSpan.textContent = "Listen to Summary ✨"; // FIXED: Used ttsTextSpan
      updateTtsIcon("volume-2"); // FIXED: Used updateIcon helper
    }, 2000);
  } finally {
    button.disabled = false;
    if (audioInstance && !audioInstance.paused) {
      // Do nothing, handled by onended listener
    } else if (!audioInstance) {
      // Only reset if error or failure
      updateTtsIcon("volume-2"); // FIXED: Used updateIcon helper
    }
  }
}

// --- Mobile Icon Update Helper ---
function updateMobileIcon(iconName, classes = "w-6 h-6") {
  updateIcon(mobileMenuIconContainer, iconName, classes);
}

// --- General Initialization ---
window.onload = function () {
  // Initialize global DOM element variables
  ttsTextSpan = document.getElementById("tts-text");
  ttsIconContainer = document.getElementById("tts-icon-container");
  mobileMenuIconContainer = document.getElementById(
    "mobile-menu-icon-container"
  );

  // Initialize Lucide icons on the entire body
  lucide.createIcons();

  // Mobile Menu Toggle Logic
  const mobileMenuButton = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");

  mobileMenuButton.addEventListener("click", () => {
    mobileMenu.classList.toggle("hidden");

    if (mobileMenu.classList.contains("hidden")) {
      updateMobileIcon("menu"); // FIXED: Used updateMobileIcon
    } else {
      updateMobileIcon("x"); // FIXED: Used updateMobileIcon
    }
  });

  // Close mobile menu when a link is clicked
  const mobileLinks = mobileMenu.querySelectorAll("a");
  mobileLinks.forEach((link) => {
    link.addEventListener("click", () => {
      mobileMenu.classList.add("hidden");
      updateMobileIcon("menu"); // FIXED: Used updateMobileIcon
    });
  });

  // Attach event listeners for Gemini Features
  document
    .getElementById("brainstorm-button")
    .addEventListener("click", handleBrainstorm);
  document.getElementById("tts-button").addEventListener("click", handleTTS);
};

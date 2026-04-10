(function () {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const transcriptBox = document.getElementById("transcriptBox");
  const answerBox = document.getElementById("answerBox");

  const DEBOUNCE_MS = 1500;
  const askedQuestions = new Set();
  const questionStarters = /^(what|how|why|when|is|can|do|should)\b/i;
  const fillerPhrases = new Set([
    "ok",
    "okay",
    "yeah",
    "hmm",
    "hmmm",
    "uh",
    "uhh",
    "huh",
    "right",
    "got it"
  ]);

  let isListening = false;
  let debounceTimer = null;
  let pendingQuestion = "";
  let isRequestInFlight = false;
  let activeListeningTabId = null;

  function setListeningState(listening) {
    isListening = listening;
    startBtn.disabled = listening;
    stopBtn.disabled = !listening;
  }

  function normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s?]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function isFillerSpeech(text) {
    const normalized = normalizeText(text).replace(/\?/g, "");
    return fillerPhrases.has(normalized);
  }

  function isQuestion(text) {
    const clean = text.trim();
    if (!clean) return false;
    if (wordCount(clean) <= 5) return false;
    if (clean.includes("?")) return true;
    return questionStarters.test(clean);
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs.length > 0 ? tabs[0] : null);
      });
    });
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function askBackend(question) {
    if (isRequestInFlight) return;
    isRequestInFlight = true;
    answerBox.textContent = "Thinking...";
    answerBox.classList.add("muted");

    try {
      const response = await fetch("http://localhost:3000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      const formatted = (data.answer || "No answer returned.").replace(/\n{3,}/g, "\n\n");
      answerBox.textContent = formatted;
      answerBox.classList.remove("muted");
    } catch (error) {
      console.error(error);
      answerBox.textContent =
        "Could not get AI suggestion. Check backend server and API key.";
      answerBox.classList.add("muted");
    } finally {
      isRequestInFlight = false;
    }
  }

  function scheduleQuestionCheck(sentence) {
    const normalized = normalizeText(sentence);
    if (!normalized) return;
    if (isFillerSpeech(sentence)) return;
    if (!isQuestion(sentence)) return;
    if (askedQuestions.has(normalized)) return;

    pendingQuestion = sentence.trim();

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      const normalizedPending = normalizeText(pendingQuestion);
      if (!normalizedPending || askedQuestions.has(normalizedPending)) {
        return;
      }

      askedQuestions.add(normalizedPending);
      await askBackend(pendingQuestion);
      pendingQuestion = "";
    }, DEBOUNCE_MS);
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== "TRANSCRIPT") return;

    if (
      activeListeningTabId !== null &&
      sender?.tab?.id &&
      sender.tab.id !== activeListeningTabId
    ) {
      return;
    }

    transcriptBox.textContent = msg.data || "Listening...";

    if (msg.finalSegment) {
      scheduleQuestionCheck(msg.finalSegment);
    }
  });

  startBtn.addEventListener("click", async () => {
    const tab = await getActiveTab();

    if (!tab || typeof tab.id !== "number") {
      transcriptBox.textContent =
        "No active tab found. Open a website tab and try again.";
      return;
    }

    try {
      await sendTabMessage(tab.id, { type: "START" });
      activeListeningTabId = tab.id;
      setListeningState(true);
      transcriptBox.textContent = "Listening...";
    } catch (error) {
      console.error("Start message failed:", error);
      transcriptBox.textContent =
        "Cannot access this tab. Open any website (not chrome:// pages) and try again.";
      setListeningState(false);
    }
  });

  stopBtn.addEventListener("click", async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (activeListeningTabId === null) {
      setListeningState(false);
      return;
    }

    try {
      await sendTabMessage(activeListeningTabId, { type: "STOP" });
    } catch (error) {
      console.error("Stop message failed:", error);
    } finally {
      activeListeningTabId = null;
      setListeningState(false);
    }
  });
})();

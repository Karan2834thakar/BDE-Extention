(function () {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let isListening = false;
  let finalTranscript = "";

  function sendTranscript(data, finalSegment = "") {
    chrome.runtime.sendMessage({
      type: "TRANSCRIPT",
      data,
      finalSegment
    });
  }

  function ensureRecognition() {
    if (recognition || !SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interimTranscript = "";
      const finalSegments = [];

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = (result[0]?.transcript || "").trim();

        if (!text) continue;

        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${text}`.trim();
          finalSegments.push(text);
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }

      const combined = `${finalTranscript} ${interimTranscript}`.trim();
      sendTranscript(combined || "Listening...", finalSegments.join(" ").trim());
    };

    recognition.onerror = (event) => {
      sendTranscript(`Speech error: ${event.error || "unknown_error"}`);
    };

    recognition.onend = () => {
      if (!isListening) return;
      try {
        recognition.start();
      } catch (error) {
        sendTranscript(
          `Speech restart failed: ${error?.name || "UnknownError"}`
        );
      }
    };
  }

  function startListening(sendResponse) {
    if (!SpeechRecognition) {
      sendTranscript("Speech recognition is not supported on this page.");
      sendResponse({ ok: false, error: "SpeechRecognition not supported." });
      return;
    }

    ensureRecognition();

    if (isListening) {
      sendResponse({ ok: true, alreadyListening: true });
      return;
    }

    isListening = true;
    sendTranscript("Listening...");

    try {
      recognition.start();
      sendResponse({ ok: true });
    } catch (error) {
      isListening = false;
      sendTranscript(
        `Failed to start listening: ${error?.name || "UnknownError"}`
      );
      sendResponse({ ok: false, error: error?.message || "Failed to start." });
    }
  }

  function stopListening(sendResponse) {
    if (!isListening) {
      sendResponse({ ok: true, alreadyStopped: true });
      return;
    }

    isListening = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch (_error) {
        // Ignore stop failures; listener state is already reset.
      }
    }

    sendTranscript(finalTranscript || "Stopped.");
    sendResponse({ ok: true });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "START") {
      startListening(sendResponse);
      return true;
    }

    if (message?.type === "STOP") {
      stopListening(sendResponse);
      return true;
    }

    return false;
  });
})();

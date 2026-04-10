/**
 * Audio utility functions for capturing and processing audio
 */

export class AudioCapture {
  constructor(options = {}) {
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];
    this.isRecording = false;
    
    this.options = {
      mimeType: 'audio/wav',
      audioBitsPerSecond: 128000,
      ...options,
    };
  }

  /**
   * Request microphone permission and initialize audio capture.
   */
  async initialize() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
        video: false,
      });

      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: this.options.mimeType,
        audioBitsPerSecond: this.options.audioBitsPerSecond,
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      return true;
    } catch (error) {
      console.error('Failed to initialize audio capture:', error);
      throw new Error(`Microphone access denied: ${error.message}`);
    }
  }

  /**
   * Start recording audio.
   */
  startRecording(timeslice = 1000) {
    if (!this.mediaRecorder) {
      throw new Error('Audio capture not initialized');
    }

    this.audioChunks = [];
    this.isRecording = true;
    this.mediaRecorder.start(timeslice);
  }

  /**
   * Stop recording audio.
   */
  stopRecording() {
    if (!this.mediaRecorder) {
      throw new Error('Audio capture not initialized');
    }

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        const audioBlob = new Blob(this.audioChunks, { type: this.options.mimeType });
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Get current recording chunks.
   */
  getChunks() {
    return new Blob(this.audioChunks, { type: this.options.mimeType });
  }

  /**
   * Stop all streams and cleanup.
   */
  cleanup() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }

    this.audioChunks = [];
    this.isRecording = false;
  }

  /**
   * Check if microphone is available.
   */
  static async isMicrophoneAvailable() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'audioinput');
    } catch {
      return false;
    }
  }
}

/**
 * WebSocket utility for streaming audio to server.
 */
export class TranscriptionClient {
  constructor(wsUrl = process.env.REACT_APP_WS_URL) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.connectionId = null;
    this.isConnected = false;
    this.listeners = new Map();
  }

  /**
   * Connect to WebSocket server.
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          console.log('✓ Connected to transcription service');
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Extract connection ID from ready message
            if (message.type === 'ready' && message.connectionId) {
              this.connectionId = message.connectionId;
            }

            this.emit('message', message);
            this.emit(message.type, message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          console.log('✗ Disconnected from service');
          this.emit('disconnected');
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send audio chunk to server.
   */
  async sendAudio(audioBlob) {
    if (!this.isConnected) {
      throw new Error('Not connected to server');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          // Convert array buffer to base64
          const audioData = btoa(
            new Uint8Array(reader.result)
              .reduce((data, byte) => data + String.fromCharCode(byte), '')
          );

          this.ws.send(JSON.stringify({
            type: 'audio',
            data: audioData,
          }));

          resolve();
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Finalize the stream and get final transcription.
   */
  finalize() {
    if (!this.isConnected) {
      throw new Error('Not connected to server');
    }

    this.ws.send(JSON.stringify({
      type: 'final',
    }));
  }

  /**
   * Reset connection state.
   */
  reset() {
    if (!this.isConnected) {
      throw new Error('Not connected to server');
    }

    this.ws.send(JSON.stringify({
      type: 'reset',
    }));
  }

  /**
   * Register event listener.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener.
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit event to all listeners.
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(callback => callback(data));
  }

  /**
   * Close WebSocket connection.
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }
}

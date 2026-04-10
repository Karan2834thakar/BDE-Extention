import React, { useState, useEffect, useRef } from 'react';
import { AudioCapture, TranscriptionClient } from '../services/AudioService';
import './TranscriptionApp.css';

export const TranscriptionApp = () => {
  // State
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
  const [transcriptionText, setTranscriptionText] = useState('');
  const [partialText, setPartialText] = useState('');
  const [finalText, setFinalText] = useState('');
  
  const [error, setError] = useState(null);
  const [errorDetails, setErrorDetails] = useState('');
  const [status, setStatus] = useState('Initializing...');
  
  const [stats, setStats] = useState({
    totalChunks: 0,
    segments: [],
  });

  // Refs
  const audioCaptureRef = useRef(null);
  const clientRef = useRef(null);
  const recordingIntervalRef = useRef(null);

  // Initialize on mount
  useEffect(() => {
    initializeApp();

    return () => {
      cleanup();
    };
  }, []);

  const initializeApp = async () => {
    try {
      setIsInitializing(true);
      setStatus('Checking microphone...');

      // Check if microphone is available
      const micAvailable = await AudioCapture.isMicrophoneAvailable();
      if (!micAvailable) {
        throw new Error('No microphone found on this device');
      }

      setStatus('Initializing audio capture...');

      // Initialize audio capture
      audioCaptureRef.current = new AudioCapture({
        mimeType: 'audio/wav',
        audioBitsPerSecond: 128000,
      });

      await audioCaptureRef.current.initialize();

      setStatus('Connecting to transcription service...');

      // Connect to WebSocket
      clientRef.current = new TranscriptionClient(
        process.env.REACT_APP_WS_URL || 'ws://localhost:3000/ws'
      );

      // Setup event listeners
      clientRef.current.on('connected', handleConnected);
      clientRef.current.on('disconnected', handleDisconnected);
      clientRef.current.on('error', handleError);
      clientRef.current.on('text', handleTranscriptionText);
      clientRef.current.on('partial', handlePartialText);
      clientRef.current.on('final', handleFinalText);
      clientRef.current.on('silence', handleSilence);

      await clientRef.current.connect();
      setIsInitializing(false);
    } catch (err) {
      console.error('Initialization error:', err);
      setError(true);
      setErrorDetails(err.message);
      setStatus('Error: ' + err.message);
      setIsInitializing(false);
    }
  };

  const handleConnected = () => {
    setIsConnected(true);
    setStatus('Ready to record');
    setError(false);
    setErrorDetails('');
  };

  const handleDisconnected = () => {
    setIsConnected(false);
    setStatus('Disconnected from service');
  };

  const handleError = (errorMsg) => {
    console.error('Error from service:', errorMsg);
    setError(true);
    if (typeof errorMsg === 'object' && errorMsg.message) {
      setErrorDetails(errorMsg.message);
    } else {
      setErrorDetails(String(errorMsg));
    }
  };

  const handleTranscriptionText = (message) => {
    if (message.text) {
      setTranscriptionText(message.text);
      setStats(prev => ({
        ...prev,
        segments: message.segments || [],
      }));
    }
  };

  const handlePartialText = (message) => {
    if (message.text) {
      setPartialText(message.text);
    }
  };

  const handleFinalText = (message) => {
    if (message.text) {
      setFinalText(message.text);
      setTranscriptionText(message.text);
    }
  };

  const handleSilence = () => {
    setStatus('Silence detected...');
  };

  const startRecording = () => {
    try {
      if (!audioCaptureRef.current) {
        throw new Error('Audio capture not initialized');
      }

      setError(false);
      setErrorDetails('');
      setTranscriptionText('');
      setPartialText('');
      setFinalText('');
      setStatus('Recording...');

      audioCaptureRef.current.startRecording(1000); // 1 second chunks
      setIsRecording(true);

      // Send audio chunks every 1 second
      recordingIntervalRef.current = setInterval(async () => {
        try {
          const audioChunk = audioCaptureRef.current.getChunks();
          if (audioChunk.size > 0) {
            await clientRef.current.sendAudio(audioChunk);
            setStats(prev => ({
              ...prev,
              totalChunks: prev.totalChunks + 1,
            }));
          }
        } catch (err) {
          console.error('Failed to send audio chunk:', err);
        }
      }, 1000);
    } catch (err) {
      console.error('Start recording error:', err);
      setError(true);
      setErrorDetails(err.message);
      setStatus('Error: ' + err.message);
    }
  };

  const stopRecording = async () => {
    try {
      setStatus('Processing...');

      // Clear interval
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }

      // Stop recording
      await audioCaptureRef.current.stopRecording();
      setIsRecording(false);

      // Send final message
      clientRef.current.finalize();

      setStatus('Recording stopped. Waiting for final transcription...');
    } catch (err) {
      console.error('Stop recording error:', err);
      setError(true);
      setErrorDetails(err.message);
      setStatus('Error: ' + err.message);
    }
  };

  const resetTranscription = () => {
    try {
      clientRef.current.reset();
      setTranscriptionText('');
      setPartialText('');
      setFinalText('');
      setStats({ totalChunks: 0, segments: [] });
      setStatus('Ready to record');
      setError(false);
    } catch (err) {
      console.error('Reset error:', err);
      setError(true);
      setErrorDetails(err.message);
    }
  };

  const cleanup = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }

    if (audioCaptureRef.current) {
      audioCaptureRef.current.cleanup();
    }

    if (clientRef.current) {
      clientRef.current.close();
    }
  };

  return (
    <div className="transcription-app">
      <div className="container">
        {/* Header */}
        <header className="header">
          <h1>🎤 Real-time Transcription</h1>
          <p>Powered by Whisper + FastAPI</p>
        </header>

        {/* Status Bar */}
        <div className={`status-bar ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className="status-indicator">
            <span className={`dot ${isConnected ? 'online' : 'offline'}`}></span>
            <span className="status-text">{status}</span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-container">
            <h3>⚠️ Error</h3>
            <p>{errorDetails}</p>
            <button onClick={initializeApp}>Retry Connection</button>
          </div>
        )}

        {/* Main Controls */}
        <div className="controls">
          <button
            className={`btn btn-record ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isConnected || isInitializing}
            title={isConnected ? 'Start/Stop recording' : 'Not connected'}
          >
            {isRecording ? (
              <>
                <span className="pulse"></span>
                ⏹️ Stop Recording
              </>
            ) : (
              <>
                🎙️ Start Recording
              </>
            )}
          </button>

          <button
            className="btn btn-reset"
            onClick={resetTranscription}
            disabled={!isConnected}
            title="Clear transcription"
          >
            🔄 Reset
          </button>

          <button
            className="btn btn-reconnect"
            onClick={initializeApp}
            disabled={isConnected && !isInitializing}
            title="Reconnect to service"
          >
            {isInitializing ? '⏳ Connecting...' : '🔗 Reconnect'}
          </button>
        </div>

        {/* Main Content Area */}
        <div className="content">
          {/* Live Transcription */}
          <div className="section">
            <h2>📝 Live Transcription</h2>
            <div className="transcription-box">
              {isRecording && (
                <div className="recording-indicator">
                  <span className="pulse"></span> Recording...
                </div>
              )}
              <p className="transcription-text">
                {transcriptionText || (isRecording ? 'Listening...' : 'Start recording to see transcription here...')}
              </p>
            </div>
          </div>

          {/* Partial Text */}
          {partialText && (
            <div className="section">
              <h2>⏳ Partial Text</h2>
              <div className="partial-box">
                <p>{partialText}</p>
              </div>
            </div>
          )}

          {/* Final Text */}
          {finalText && (
            <div className="section">
              <h2>✅ Final Transcription</h2>
              <div className="final-box">
                <p>{finalText}</p>
              </div>
            </div>
          )}

          {/* Statistics */}
          <div className="section stats">
            <h2>📊 Statistics</h2>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Audio Chunks Sent</span>
                <span className="stat-value">{stats.totalChunks}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Segments Detected</span>
                <span className="stat-value">{stats.segments.length}</span>
              </div>
            </div>

            {stats.segments.length > 0 && (
              <div className="segments">
                <h3>Detected Segments:</h3>
                <ul>
                  {stats.segments.map((seg, idx) => (
                    <li key={idx}>
                      <strong>[{seg.start.toFixed(2)}s - {seg.end.toFixed(2)}s]</strong>
                      <span>{seg.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="footer">
          <p>
            💡 <strong>Tips:</strong> Make sure the FastAPI service is running on port 8000 and the Node.js backend on port 3000.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default TranscriptionApp;

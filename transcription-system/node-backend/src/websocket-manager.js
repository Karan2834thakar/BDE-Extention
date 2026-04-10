/**
 * WebSocket connection manager for streaming audio.
 * Manages connections between clients and Python WebSocket service.
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

class WebSocketManager {
  constructor() {
    this.connections = new Map();
    this.pythonWsUrl = process.env.PYTHON_WS_URL || 'ws://localhost:8000';
    this.pythonConnections = new Map();
  }

  /**
   * Create a new streaming connection.
   * @param {WebSocket} clientWs - Client WebSocket connection
   * @returns {string} Connection ID
   */
  createConnection(clientWs) {
    const connectionId = uuidv4();
    
    logger.info(`Creating WebSocket connection: ${connectionId}`);

    // Connect to Python backend
    const pythonWs = new WebSocket(`${this.pythonWsUrl}/ws/stream`);

    const connection = {
      id: connectionId,
      clientWs,
      pythonWs,
      isActive: true,
      createdAt: Date.now(),
    };

    pythonWs.on('open', () => {
      logger.info(`✓ Python connection established: ${connectionId}`);
      // Send initial message if needed
    });

    // Forward messages from Python to client
    pythonWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(message));
        }
      } catch (error) {
        logger.error(`Failed to parse Python message: ${error.message}`);
      }
    });

    pythonWs.on('error', (error) => {
      logger.error(`Python connection error (${connectionId}): ${error.message}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'error',
          message: `Server error: ${error.message}`,
        }));
      }
    });

    pythonWs.on('close', () => {
      logger.info(`Python connection closed: ${connectionId}`);
      connection.isActive = false;
    });

    this.connections.set(connectionId, connection);
    this.pythonConnections.set(connectionId, pythonWs);

    return connectionId;
  }

  /**
   * Send audio chunk to Python service.
   * @param {string} connectionId - Connection ID
   * @param {Buffer} audioData - Audio chunk data (base64 encoded)
   */
  sendAudio(connectionId, audioData) {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.isActive) {
      throw new Error(`Connection not found or inactive: ${connectionId}`);
    }

    const pythonWs = this.pythonConnections.get(connectionId);
    if (pythonWs && pythonWs.readyState === WebSocket.OPEN) {
      pythonWs.send(JSON.stringify({
        type: 'audio',
        data: audioData,
      }));
    }
  }

  /**
   * Send final message to close streaming.
   * @param {string} connectionId - Connection ID
   */
  finalizeStream(connectionId) {
    const pythonWs = this.pythonConnections.get(connectionId);
    if (pythonWs && pythonWs.readyState === WebSocket.OPEN) {
      pythonWs.send(JSON.stringify({
        type: 'final',
      }));
    }
  }

  /**
   * Reset connection state.
   * @param {string} connectionId - Connection ID
   */
  resetConnection(connectionId) {
    const pythonWs = this.pythonConnections.get(connectionId);
    if (pythonWs && pythonWs.readyState === WebSocket.OPEN) {
      pythonWs.send(JSON.stringify({
        type: 'reset',
      }));
    }
  }

  /**
   * Close a connection.
   * @param {string} connectionId - Connection ID
   */
  closeConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    const pythonWs = this.pythonConnections.get(connectionId);

    logger.info(`Closing connection: ${connectionId}`);

    if (pythonWs && pythonWs.readyState === WebSocket.OPEN) {
      pythonWs.close();
    }

    this.connections.delete(connectionId);
    this.pythonConnections.delete(connectionId);
  }

  /**
   * Get connection stats.
   */
  getStats() {
    const stats = {
      totalConnections: this.connections.size,
      activeConnections: Array.from(this.connections.values()).filter(c => c.isActive).length,
      connections: Array.from(this.connections.values()).map(c => ({
        id: c.id,
        isActive: c.isActive,
        createdAt: c.createdAt,
        duration: Date.now() - c.createdAt,
      })),
    };
    return stats;
  }
}

module.exports = new WebSocketManager();

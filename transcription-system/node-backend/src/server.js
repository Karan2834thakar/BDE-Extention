/**
 * Express server for real-time transcription backend.
 * Handles REST API and WebSocket connections.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

const logger = require('./logger');
const transcriptionService = require('./transcription-service');
const websocketManager = require('./websocket-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
});

// ==================== HEALTH CHECK ====================

app.get('/health', async (req, res) => {
  try {
    const pythonHealth = await transcriptionService.checkHealth();
    
    const health = {
      status: pythonHealth.healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      pythonService: pythonHealth,
    };

    res.json(health);
  } catch (error) {
    logger.error(`Health check error: ${error.message}`);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// ==================== REST API ENDPOINTS ====================

/**
 * POST /api/transcribe
 * Transcribe a single audio file.
 */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided',
      });
    }

    logger.info(`Transcription request: ${req.file.originalname}`);

    const result = await transcriptionService.transcribeFile(
      req.file.buffer,
      req.file.originalname
    );

    res.json({
      success: true,
      requestId: uuidv4(),
      data: result,
    });
  } catch (error) {
    logger.error(`Transcription endpoint error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/transcribe-batch
 * Transcribe multiple audio files.
 */
app.post('/api/transcribe-batch', upload.array('audio', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No audio files provided',
      });
    }

    logger.info(`Batch transcription request: ${req.files.length} files`);

    const audioBuffers = req.files.map(f => f.buffer);
    const filenames = req.files.map(f => f.originalname);

    const results = await transcriptionService.transcribeBatch(audioBuffers, filenames);

    res.json({
      success: true,
      requestId: uuidv4(),
      count: results.length,
      data: results,
    });
  } catch (error) {
    logger.error(`Batch transcription error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/connections/stats
 * Get WebSocket connection statistics.
 */
app.get('/api/connections/stats', (req, res) => {
  const stats = websocketManager.getStats();
  res.json(stats);
});

// ==================== WEBSOCKET ENDPOINT ====================

/**
 * WebSocket /ws
 * Handle streaming audio transcription.
 */
const wsServer = new WebSocket.Server({ noServer: true });

wsServer.on('connection', (clientWs) => {
  logger.info('Client WebSocket connected');

  try {
    // Create connection to Python backend
    const connectionId = websocketManager.createConnection(clientWs);

    // Handle messages from client
    clientWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        switch (message.type) {
          case 'audio':
            // Forward audio to Python service
            websocketManager.sendAudio(connectionId, message.data);
            break;

          case 'final':
            // Finalize stream
            websocketManager.finalizeStream(connectionId);
            break;

          case 'reset':
            // Reset connection
            websocketManager.resetConnection(connectionId);
            break;

          default:
            logger.warn(`Unknown message type: ${message.type}`);
        }
      } catch (error) {
        logger.error(`WebSocket message error: ${error.message}`);
        clientWs.send(JSON.stringify({
          type: 'error',
          message: error.message,
        }));
      }
    });

    // Handle client disconnect
    clientWs.on('close', () => {
      logger.info(`Client WebSocket closed: ${connectionId}`);
      websocketManager.closeConnection(connectionId);
    });

    clientWs.on('error', (error) => {
      logger.error(`Client WebSocket error: ${error.message}`);
      websocketManager.closeConnection(connectionId);
    });

    // Send welcome message
    clientWs.send(JSON.stringify({
      type: 'ready',
      connectionId,
      message: 'Connected to transcription service',
    }));
  } catch (error) {
    logger.error(`WebSocket connection error: ${error.message}`);
    clientWs.close();
  }
});

// Handle HTTP upgrade for WebSocket
const server = require('http').createServer(app);

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ==================== ERROR HANDLING ====================

app.use((error, req, res, next) => {
  logger.error(`Unhandled error: ${error.message}`, error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
});

// ==================== SERVER STARTUP ====================

server.listen(PORT, HOST, async () => {
  logger.info(`✓ Server running on http://${HOST}:${PORT}`);
  logger.info(`✓ WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
  logger.info(`✓ Transcription API: http://${HOST}:${PORT}/api/transcribe`);

  // Check Python service health
  const pythonHealth = await transcriptionService.checkHealth();
  if (!pythonHealth.healthy) {
    logger.warn('⚠ Python service is not available. Make sure to start it.');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = app;

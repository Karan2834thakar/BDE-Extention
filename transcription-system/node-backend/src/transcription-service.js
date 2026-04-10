/**
 * Audio transcription service - manages communication with Python FastAPI backend.
 */

const axios = require('axios');
const logger = require('./logger');

class TranscriptionService {
  constructor() {
    this.pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
    this.client = axios.create({
      baseURL: this.pythonServiceUrl,
      timeout: 30000,
    });
  }

  /**
   * Check if Python service is healthy.
   */
  async checkHealth() {
    try {
      const response = await this.client.get('/health');
      logger.info(`✓ Python service healthy: ${response.data.model} on ${response.data.device}`);
      return { healthy: true, data: response.data };
    } catch (error) {
      logger.error(`✗ Python service health check failed: ${error.message}`);
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Transcribe a single audio file.
   * @param {Buffer} audioBuffer - Audio file buffer
   * @param {string} filename - Original filename
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeFile(audioBuffer, filename) {
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer]);
      formData.append('file', blob, filename);

      logger.info(`Transcribing file: ${filename} (${audioBuffer.length} bytes)`);

      const response = await this.client.post('/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      logger.info(`✓ Transcription complete: "${response.data.text.substring(0, 50)}..."`);
      return response.data;
    } catch (error) {
      logger.error(`Transcription failed: ${error.message}`);
      throw new Error(`Transcription service error: ${error.message}`);
    }
  }

  /**
   * Transcribe multiple files in batch.
   * @param {Array<Buffer>} audioBuffers - Array of audio buffers
   * @param {Array<string>} filenames - Array of filenames
   * @returns {Promise<Array>} Array of transcription results
   */
  async transcribeBatch(audioBuffers, filenames) {
    try {
      const formData = new FormData();
      audioBuffers.forEach((buffer, index) => {
        const blob = new Blob([buffer]);
        formData.append('files', blob, filenames[index]);
      });

      logger.info(`Transcribing batch of ${audioBuffers.length} files`);

      const response = await this.client.post('/transcribe_batch', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      logger.info(`✓ Batch transcription complete`);
      return response.data;
    } catch (error) {
      logger.error(`Batch transcription failed: ${error.message}`);
      throw new Error(`Batch transcription error: ${error.message}`);
    }
  }
}

module.exports = new TranscriptionService();

"""
FastAPI service for real-time audio transcription.
Provides REST and WebSocket endpoints for transcription.
"""

import asyncio
import logging
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
from typing import Optional, List
import os
from dotenv import load_dotenv

from app.whisper_model import get_whisper_manager
from app.audio_processor import AudioProcessor

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Real-time Transcription Service",
    description="WebSocket and REST API for audio transcription using Whisper",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
MODEL_NAME = os.getenv("WHISPER_MODEL", "medium")
DEVICE = os.getenv("WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "float16")
LANGUAGE = os.getenv("LANGUAGE", "en")

# Initialize Whisper on startup
whisper_manager = None


@app.on_event("startup")
async def startup_event():
    """Initialize Whisper model on application startup."""
    global whisper_manager
    try:
        logger.info("Initializing Whisper model...")
        whisper_manager = get_whisper_manager(
            model_name=MODEL_NAME,
            device=DEVICE,
            compute_type=COMPUTE_TYPE
        )
        logger.info("✓ Application ready for transcription")
    except Exception as e:
        logger.error(f"Failed to initialize: {e}")
        raise


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE
    }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    """
    Transcribe a single audio file.
    
    Args:
        file: Audio file (wav, webm, mp3, etc.)
        
    Returns:
        JSON with transcribed text and segments
    """
    if whisper_manager is None:
        raise HTTPException(status_code=500, detail="Model not initialized")
    
    try:
        # Read file
        contents = await file.read()
        logger.info(f"Received audio file: {file.filename} ({len(contents)} bytes)")
        
        # Process audio
        audio = AudioProcessor.process_chunk(contents)
        
        if AudioProcessor.is_silence(audio):
            return {
                "success": True,
                "text": "",
                "segments": [],
                "is_silence": True
            }
        
        # Transcribe
        text, segments = whisper_manager.transcribe(audio, language=LANGUAGE)
        
        return {
            "success": True,
            "text": text,
            "segments": segments,
            "is_silence": False,
            "language": LANGUAGE
        }
    
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/stream")
async def websocket_transcribe(websocket: WebSocket):
    """
    WebSocket endpoint for real-time streaming transcription.
    
    Protocol:
    - Client sends: {"type": "audio", "data": base64_encoded_audio}
    - Server responds: {"type": "text", "text": "...", "is_final": false/true}
    - Client can send: {"type": "reset"} to clear previous context
    """
    await websocket.accept()
    logger.info("WebSocket connection established")
    
    try:
        buffer = []
        buffer_duration = 0.0
        chunk_duration = 1.0  # 1 second chunks
        
        while True:
            # Receive message from client
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)
            except asyncio.TimeoutError:
                logger.warning("WebSocket timeout")
                await websocket.send_json({
                    "type": "error",
                    "message": "Timeout: no audio received"
                })
                continue
            
            message_type = data.get("type")
            
            if message_type == "audio":
                try:
                    # Decode audio data
                    import base64
                    audio_b64 = data.get("data")
                    audio_bytes = base64.b64decode(audio_b64)
                    
                    # Process audio chunk
                    audio = AudioProcessor.process_chunk(audio_bytes)
                    
                    # Check for silence
                    if AudioProcessor.is_silence(audio):
                        await websocket.send_json({
                            "type": "silence",
                            "message": "Silence detected"
                        })
                        continue
                    
                    # Buffer audio
                    buffer.append(audio)
                    buffer_duration += len(audio) / AudioProcessor.SAMPLE_RATE
                    
                    # Process when buffer reaches chunk duration
                    if buffer_duration >= chunk_duration:
                        # Concatenate buffers
                        combined_audio = np.concatenate(buffer)
                        
                        # Transcribe
                        text, segments = whisper_manager.transcribe(
                            combined_audio,
                            language=LANGUAGE
                        )
                        
                        # Send response
                        await websocket.send_json({
                            "type": "text",
                            "text": text,
                            "segments": segments,
                            "is_final": False,
                            "timestamp": buffer_duration
                        })
                        
                        # Reset buffer
                        buffer = []
                        buffer_duration = 0.0
                    
                    # Send partial response for smaller chunks
                    elif len(buffer) % 2 == 0:  # Every 2 chunks
                        combined_audio = np.concatenate(buffer)
                        text, _ = whisper_manager.transcribe(
                            combined_audio,
                            language=LANGUAGE
                        )
                        
                        await websocket.send_json({
                            "type": "partial",
                            "text": text,
                            "timestamp": buffer_duration
                        })
                
                except Exception as e:
                    logger.error(f"Audio processing error: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Processing error: {str(e)}"
                    })
            
            elif message_type == "reset":
                # Clear buffer and reset state
                buffer = []
                buffer_duration = 0.0
                await websocket.send_json({
                    "type": "reset_ack",
                    "message": "Buffer cleared"
                })
            
            elif message_type == "final":
                # Process final buffer
                if buffer:
                    combined_audio = np.concatenate(buffer)
                    text, segments = whisper_manager.transcribe(
                        combined_audio,
                        language=LANGUAGE
                    )
                    
                    await websocket.send_json({
                        "type": "final",
                        "text": text,
                        "segments": segments,
                        "is_final": True
                    })
                
                # Reset buffer
                buffer = []
                buffer_duration = 0.0
            
            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {message_type}"
                })
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Server error: {str(e)}"
            })
        except:
            pass


@app.post("/transcribe_batch")
async def transcribe_batch(files: List[UploadFile] = File(...)) -> list:
    """
    Transcribe multiple audio files in parallel.
    
    Args:
        files: List of audio files
        
    Returns:
        List of transcription results
    """
    if whisper_manager is None:
        raise HTTPException(status_code=500, detail="Model not initialized")
    
    async def process_file(file):
        try:
            contents = await file.read()
            audio = AudioProcessor.process_chunk(contents)
            
            if AudioProcessor.is_silence(audio):
                return {
                    "filename": file.filename,
                    "text": "",
                    "segments": [],
                    "is_silence": True
                }
            
            text, segments = whisper_manager.transcribe(audio, language=LANGUAGE)
            return {
                "filename": file.filename,
                "text": text,
                "segments": segments,
                "is_silence": False
            }
        except Exception as e:
            return {
                "filename": file.filename,
                "error": str(e)
            }
    
    # Process files concurrently
    results = await asyncio.gather(*[process_file(f) for f in files])
    return results


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )

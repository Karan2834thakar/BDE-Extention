"""
Whisper model manager with singleton pattern.
Handles loading faster-whisper model once and reusing it for all transcriptions.
"""

import numpy as np
from faster_whisper import WhisperModel
from typing import List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)


class WhisperManager:
    """Singleton manager for faster-whisper model."""
    
    _instance = None
    _model = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(
        self,
        model_name: str = "medium",
        device: str = "auto",
        compute_type: str = "float16",
        num_workers: int = 4
    ):
        """
        Initialize Whisper manager.
        
        Args:
            model_name: Model size (tiny, base, small, medium, large)
            device: Device to use (cuda, cpu, auto)
            compute_type: Computation type (float16, int8, float32)
            num_workers: Number of workers for parallel processing
        """
        if self._model is None:
            self.model_name = model_name
            self.device = self._resolve_device(device)
            self.compute_type = compute_type
            self.num_workers = num_workers
            
            logger.info(f"Loading Whisper model: {model_name} on {self.device}")
            self._load_model()
    
    def _resolve_device(self, device: str) -> str:
        """Resolve device, fallback to CPU if CUDA unavailable."""
        if device == "auto":
            try:
                import torch
                return "cuda" if torch.cuda.is_available() else "cpu"
            except:
                return "cpu"
        return device
    
    def _load_model(self):
        """Load faster-whisper model."""
        try:
            self._model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
                num_workers=self.num_workers
            )
            logger.info(f"✓ Whisper model loaded successfully on {self.device}")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            # Fallback to CPU
            if self.device != "cpu":
                logger.info("Falling back to CPU...")
                self.device = "cpu"
                self._model = WhisperModel(
                    self.model_name,
                    device="cpu",
                    compute_type="float32",
                    num_workers=1
                )
            else:
                raise
    
    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "en"
    ) -> Tuple[str, List[dict]]:
        """
        Transcribe audio chunk.
        
        Args:
            audio: Audio array
            language: Language code
            
        Returns:
            Tuple of (text, segments)
        """
        if self._model is None:
            raise RuntimeError("Model not loaded")
        
        try:
            segments, info = self._model.transcribe(
                audio,
                language=language,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    min_speech_duration_ms=250
                ),
                condition_on_previous_text=False
            )
            
            # Extract text and segment info
            full_text = ""
            segment_list = []
            
            for segment in segments:
                full_text += segment.text + " "
                segment_list.append({
                    "id": segment.id,
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text,
                    "confidence": segment.confidence if hasattr(segment, "confidence") else 1.0
                })
            
            return full_text.strip(), segment_list
        
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return "", []
    
    def stream_transcribe(
        self,
        audio: np.ndarray,
        language: str = "en"
    ) -> str:
        """
        Stream transcribe with minimal latency.
        Returns partial results as they become available.
        
        Args:
            audio: Audio array
            language: Language code
            
        Returns:
            Transcribed text (partial or final)
        """
        # For live streaming, we return the first complete segment
        segments, _ = self._model.transcribe(
            audio,
            language=language,
            beam_size=3,  # Reduce for faster processing
            vad_filter=True,
            condition_on_previous_text=False
        )
        
        text = ""
        for segment in segments:
            text += segment.text + " "
        
        return text.strip()


# Global instance
whisper_manager = None


def get_whisper_manager(
    model_name: str = "medium",
    device: str = "auto",
    compute_type: str = "float16"
) -> WhisperManager:
    """Get the global Whisper manager instance."""
    global whisper_manager
    if whisper_manager is None:
        whisper_manager = WhisperManager(
            model_name=model_name,
            device=device,
            compute_type=compute_type
        )
    return whisper_manager

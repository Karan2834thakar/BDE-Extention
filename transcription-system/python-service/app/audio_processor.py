"""
Audio processing utilities for real-time transcription.
Handles VAD, silence removal, chunk normalization, and format conversion.
"""

import numpy as np
import librosa
from scipy import signal
import io
from typing import Tuple, Optional


class AudioProcessor:
    """Process audio chunks for optimal transcription."""
    
    # Audio configuration
    SAMPLE_RATE = 16000
    CHUNK_DURATION_MS = 1000  # 1 second chunks
    SILENCE_THRESHOLD = 0.02  # Amplitude threshold for silence
    MIN_SOUND_DURATION = 0.5  # Minimum sound duration in seconds
    
    @staticmethod
    def bytes_to_audio(audio_bytes: bytes, format_type: str = "wav") -> Tuple[np.ndarray, int]:
        """
        Convert audio bytes to numpy array.
        
        Args:
            audio_bytes: Raw audio bytes
            format_type: Audio format (wav, webm, etc.)
            
        Returns:
            Tuple of (audio_array, sample_rate)
        """
        try:
            # Use librosa to load audio from bytes
            audio_file = io.BytesIO(audio_bytes)
            audio_array, sr = librosa.load(audio_file, sr=AudioProcessor.SAMPLE_RATE, mono=True)
            return audio_array, sr
        except Exception as e:
            print(f"Error converting audio: {e}")
            return np.array([]), AudioProcessor.SAMPLE_RATE
    
    @staticmethod
    def apply_vad(audio: np.ndarray, sr: int = SAMPLE_RATE, energy_threshold: float = 0.02) -> np.ndarray:
        """
        Apply Voice Activity Detection using energy-based method.
        
        Args:
            audio: Audio array
            sr: Sample rate
            energy_threshold: Energy threshold for voice detection
            
        Returns:
            Filtered audio with silence removed
        """
        # Compute frame energy
        frame_length = int(sr * 0.02)  # 20ms frames
        hop_length = frame_length // 2
        
        # Extract frames
        frames = librosa.util.frame(audio, frame_length=frame_length, hop_length=hop_length)
        energies = np.sqrt(np.mean(frames ** 2, axis=0))
        
        # Simple energy threshold
        voice_flag = energies > energy_threshold
        
        # Expand frames to full length
        voice_frames = np.repeat(voice_flag, hop_length)
        
        # Pad to match original length
        if len(voice_frames) < len(audio):
            voice_frames = np.pad(voice_frames, (0, len(audio) - len(voice_frames)))
        else:
            voice_frames = voice_frames[:len(audio)]
        
        # Apply voice mask
        return audio * voice_frames
    
    @staticmethod
    def normalize_audio(audio: np.ndarray, target_db: float = -20.0) -> np.ndarray:
        """
        Normalize audio to target loudness.
        
        Args:
            audio: Audio array
            target_db: Target loudness in dB
            
        Returns:
            Normalized audio
        """
        # Prevent division by zero
        rms = np.sqrt(np.mean(audio ** 2))
        if rms < 1e-7:
            return audio
        
        # Calculate current dB
        current_db = 20 * np.log10(rms + 1e-10)
        
        # Calculate gain needed
        gain_db = target_db - current_db
        gain = 10 ** (gain_db / 20.0)
        
        # Apply gain with soft clipping
        normalized = audio * gain
        normalized = np.tanh(normalized)  # Soft clipping
        
        return normalized
    
    @staticmethod
    def remove_noise(audio: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
        """
        Simple noise reduction using spectral subtraction.
        
        Args:
            audio: Audio array
            sr: Sample rate
            
        Returns:
            Noise-reduced audio
        """
        # Compute STFT
        D = librosa.stft(audio)
        magnitude = np.abs(D)
        phase = np.angle(D)
        
        # Estimate noise from quietest frames
        noise_profile = np.percentile(magnitude, 10, axis=1, keepdims=True)
        
        # Spectral subtraction
        cleaned_magnitude = magnitude - noise_profile
        cleaned_magnitude = np.maximum(cleaned_magnitude, 0.1 * magnitude)  # Prevent over-subtraction
        
        # Reconstruct
        D_cleaned = cleaned_magnitude * np.exp(1j * phase)
        audio_cleaned = librosa.istft(D_cleaned)
        
        return audio_cleaned
    
    @staticmethod
    def process_chunk(audio_bytes: bytes, apply_cleanup: bool = True) -> np.ndarray:
        """
        Complete audio processing pipeline.
        
        Args:
            audio_bytes: Raw audio bytes
            apply_cleanup: Whether to apply noise reduction and VAD
            
        Returns:
            Processed audio array
        """
        # Convert bytes to audio
        audio, sr = AudioProcessor.bytes_to_audio(audio_bytes)
        
        if len(audio) == 0:
            return audio
        
        # Apply processing pipeline
        if apply_cleanup:
            # 1. Remove noise
            audio = AudioProcessor.remove_noise(audio, sr)
            
            # 2. Apply VAD
            audio = AudioProcessor.apply_vad(audio, sr)
            
            # 3. Normalize
            audio = AudioProcessor.normalize_audio(audio)
        
        # Ensure proper sample rate
        if sr != AudioProcessor.SAMPLE_RATE:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=AudioProcessor.SAMPLE_RATE)
        
        return audio
    
    @staticmethod
    def is_silence(audio: np.ndarray, threshold: float = SILENCE_THRESHOLD) -> bool:
        """Check if audio chunk is mostly silence."""
        if len(audio) == 0:
            return True
        
        rms = np.sqrt(np.mean(audio ** 2))
        return rms < threshold

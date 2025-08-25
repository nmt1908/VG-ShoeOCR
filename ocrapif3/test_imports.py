#!/usr/bin/env python3

# Test script to check which imports are working
import sys

try:
    import io
    print("✓ io")
except ImportError as e:
    print(f"✗ io: {e}")

try:
    import json
    print("✓ json")
except ImportError as e:
    print(f"✗ json: {e}")

try:
    import uuid
    print("✓ uuid")
except ImportError as e:
    print(f"✗ uuid: {e}")

try:
    import cv2
    print("✓ cv2")
except ImportError as e:
    print(f"✗ cv2: {e}")

try:
    import numpy as np
    print("✓ numpy")
except ImportError as e:
    print(f"✗ numpy: {e}")

try:
    from fastapi import FastAPI, File, UploadFile, Form, Query, HTTPException
    print("✓ fastapi")
except ImportError as e:
    print(f"✗ fastapi: {e}")

try:
    from fastapi.responses import JSONResponse, StreamingResponse
    print("✓ fastapi.responses")
except ImportError as e:
    print(f"✗ fastapi.responses: {e}")

try:
    from fastapi.middleware.cors import CORSMiddleware
    print("✓ fastapi.middleware.cors")
except ImportError as e:
    print(f"✗ fastapi.middleware.cors: {e}")

try:
    from PIL import Image
    print("✓ PIL")
except ImportError as e:
    print(f"✗ PIL: {e}")

try:
    from io import BytesIO
    print("✓ BytesIO")
except ImportError as e:
    print(f"✗ BytesIO: {e}")

try:
    import torch
    print(f"✓ torch {torch.__version__}")
except ImportError as e:
    print(f"✗ torch: {e}")

try:
    import uvicorn
    print("✓ uvicorn")
except ImportError as e:
    print(f"✗ uvicorn: {e}")

try:
    from torchvision import transforms as T
    print("✓ torchvision.transforms")
except ImportError as e:
    print(f"✗ torchvision.transforms: {e}")

try:
    from transformers import AutoModelForCausalLM
    print("✓ transformers")
except ImportError as e:
    print(f"✗ transformers: {e}")

try:
    from rembg import remove
    print("✓ rembg")
except ImportError as e:
    print(f"✗ rembg: {e}")

print(f"\nPython version: {sys.version}")

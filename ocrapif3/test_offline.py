#!/usr/bin/env python3
"""
Test script to verify offline OCR functionality
"""

import os
import requests
from PIL import Image
import io

def test_offline_ocr():
    # Create a simple test image with text
    img = Image.new('RGB', (200, 50), color='white')
    
    # Convert to bytes
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    
    # Test the API
    try:
        url = "http://localhost:8000/sole_inkjet_ocr"
        files = {'image': ('test.png', img_bytes, 'image/png')}
        data = {'model_name': 'parseq'}
        
        response = requests.post(url, files=files, data=data)
        
        if response.status_code == 200:
            result = response.json()
            print("✓ Offline OCR working!")
            print(f"Response: {result}")
        else:
            print(f"✗ Error: {response.status_code}")
            print(response.text)
            
    except requests.exceptions.ConnectionError:
        print("✗ Server not running. Please start the server first:")
        print("python parsec_ocr_api_offline.py")
    except Exception as e:
        print(f"✗ Error: {e}")

if __name__ == "__main__":
    test_offline_ocr()

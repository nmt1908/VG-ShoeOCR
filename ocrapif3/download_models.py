#!/usr/bin/env python3
"""
Script to pre-download and cache PARSeq models for offline use.
Run this script once when you have internet connectivity.
"""

import os
import torch

def download_models():
    """Download and cache commonly used models"""
    models_to_download = ['parseq', 'crnn']
    
    print("Downloading and caching PARSeq models for offline use...")
    
    model_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(model_dir, exist_ok=True)
    
    # Set torch hub cache to local directory
    torch.hub.set_dir(model_dir)
    
    for model_name in models_to_download:
        try:
            print(f"\nDownloading {model_name}...")
            
            # Download with pretrained weights
            model = torch.hub.load('baudm/parseq', model_name, pretrained=True, trust_repo=True)
            model.eval()
            
            # Save complete model info
            model_path = os.path.join(model_dir, f'{model_name}_complete.pth')
            torch.save({
                'state_dict': model.state_dict(),
                'model_name': model_name,
            }, model_path)
            
            print(f"✓ {model_name} downloaded and cached successfully at {model_path}")
            
        except Exception as e:
            print(f"✗ Failed to download {model_name}: {e}")
    
    print("\nModel download complete! Your API can now work offline.")
    print(f"Models cached in: {model_dir}")

if __name__ == "__main__":
    download_models()

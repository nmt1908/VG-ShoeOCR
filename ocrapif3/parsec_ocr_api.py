import io
import os
import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, Query, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from io import BytesIO
import torch
import uvicorn
from torchvision import transforms as T
from strhub.data.module import SceneTextDataModule
from strhub.models.parseq.system import PARSeq

app = FastAPI()

# Add CORS middleware to allow requests from your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or use ["http://127.0.0.1:5500"] for stricter security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fully offline OCR model
class OfflineOCRModel:
    def __init__(self, model_name='parseq'):
        self._model_cache = {}
        self.model_name = model_name
        self.model_dir = os.path.join(os.path.dirname(__file__), 'models')
        os.makedirs(self.model_dir, exist_ok=True)
        
        # Device configuration
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
    def _load_model_offline(self, name):
        """Load model completely offline using the approach from gpt5.py"""
        weights_path = os.path.join(os.path.dirname(__file__), 'parseq-bb5792a6.pt')
        
        if not os.path.exists(weights_path):
            raise HTTPException(status_code=500, detail=f"Model weights not found at {weights_path}")
        
        try:
            print(f"Loading model from {weights_path}")
            # Create PARSeq model with default configuration
            config = {
                'charset_train': "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
                'charset_test': "0123456789abcdefghijklmnopqrstuvwxyz",
                'max_label_length': 25,
                'batch_size': 384,
                'lr': 7e-4,
                'warmup_pct': 0.075,
                'weight_decay': 0.0,
                'img_size': [32, 128],
                'patch_size': [4, 8],
                'embed_dim': 384,
                'enc_num_heads': 6,
                'enc_mlp_ratio': 4,
                'enc_depth': 12,
                'dec_num_heads': 12,
                'dec_mlp_ratio': 4,
                'dec_depth': 1,
                'perm_num': 6,
                'perm_forward': True,
                'perm_mirrored': True,
                'decode_ar': True,
                'refine_iters': 1,
                'dropout': 0.1
            }
            
            model = PARSeq(**config)
            # Load the state dict
            state_dict = torch.load(weights_path, map_location='cpu', weights_only=True)
            # The checkpoint contains weights for the actual model, not the Lightning wrapper
            model.model.load_state_dict(state_dict)
            model.eval()
            model.to(self.device)
            
            # Prepare transform using SceneTextDataModule
            self.transform = SceneTextDataModule.get_transform(model.hparams.img_size)
            
            print("Model loaded successfully")
            return model
            
        except Exception as e:
            print(f"Error loading model offline: {e}")
            raise HTTPException(status_code=500, detail=f"Model {name} not available offline. Error: {str(e)}")
    
    def _get_model(self, name):
        if name in self._model_cache:
            return self._model_cache[name]
        
        model = self._load_model_offline(name)
        self._model_cache[name] = model
        return model

    @torch.inference_mode()
    def predict(self, image, model_name=None):
        if image is None:
            return '', []
        try:
            print("Starting prediction...")
            model = self._get_model(model_name or self.model_name)
            
            # Prepare image using the same approach as gpt5.py
            img = image.convert('RGB')
            # Shape: (1, C, H, W)
            img_tensor = self.transform(img).unsqueeze(0).to(self.device)
            
            print("Image preprocessed and moved to device.")
            # Forward pass - exactly like gpt5.py
            with torch.no_grad():
                logits = model(img_tensor)
                pred = logits.softmax(-1)
                label, confidence = model.tokenizer.decode(pred)
            
            print("Model inference done.")
            # Get mean confidence if it's a tensor with multiple values (per character) - like gpt5.py
            conf_value = confidence[0].mean().item() if hasattr(confidence[0], 'mean') else confidence[0].item()
            
            # For backward compatibility, also get raw data
            raw_label, raw_confidence = model.tokenizer.decode(pred, raw=True)
            max_len = 25 if (model_name or self.model_name) == 'crnn' else len(label[0]) + 1
            conf_list = list(map('{:0.1f}'.format, raw_confidence[0][:max_len].tolist()))
            
            print("Prediction and decoding successful.")
            return label[0], [raw_label[0][:max_len], conf_list]
        except Exception as e:
            print(f"Prediction error: {e}")
            raise HTTPException(status_code=500, detail=f"OCR prediction failed: {str(e)}")

ocr_model = OfflineOCRModel()
#day ne
@app.post("/sole_inkjet_ocr")
async def ocr_endpoint(
    image: UploadFile = File(...),
    model_name: str = Form('parseq')
):
    try:
        contents = await image.read()
        img = Image.open(io.BytesIO(contents))
        text, raw = ocr_model.predict(img, model_name)
        
        # Print OCR results to terminal
        print(f"=== OCR Results ===")
        print(f"Detected text: {text}")
        print(f"Raw data: {raw}")
        print(f"Model used: {model_name}")
        print(f"=================")
        
        return JSONResponse({
            "text": text,
            "raw": raw,
            "status": "success"
        })
    except Exception as e:
        print(f"OCR endpoint error: {e}")
        return JSONResponse({
            "error": str(e),
            "status": "error"
        }, status_code=500)

@app.get("/health")
async def health_check():
    return {"status": "healthy", "models_cached": list(ocr_model._model_cache.keys())}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)

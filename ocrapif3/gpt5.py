#!/usr/bin/env python3
import argparse
import torch
from PIL import Image
from strhub.data.module import SceneTextDataModule
from strhub.models.parseq.system import PARSeq

def load_model(weights_path):
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
    return model

def ocr_image(model, image_path):
    # Prepare transform
    transform = SceneTextDataModule.get_transform(model.hparams.img_size)
    # Load image
    img = Image.open(image_path).convert('RGB')
    # Shape: (1, C, H, W)
    img = transform(img).unsqueeze(0)
    # Forward pass
    with torch.no_grad():
        logits = model(img)
        pred = logits.softmax(-1)
        label, confidence = model.tokenizer.decode(pred)
    # Get mean confidence if it's a tensor with multiple values (per character)
    conf_value = confidence[0].mean().item() if hasattr(confidence[0], 'mean') else confidence[0].item()
    return label[0], conf_value

def main():
    parser = argparse.ArgumentParser(description="Offline OCR with PARSEQ")
    parser.add_argument("image", help="Path to input image")
    parser.add_argument("--weights", default="parseq-bb5792a6.pt",
                        help="Path to downloaded .pt weights")
    args = parser.parse_args()

    model = load_model(args.weights)
    text, conf = ocr_image(model, args.image)
    print(f"Decoded text: {text}")
    print(f"Confidence: {conf:.4f}")

if __name__ == "__main__":
    main()

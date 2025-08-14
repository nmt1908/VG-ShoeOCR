from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse
from PIL import Image
from PIL import ImageOps
import numpy as np
import cv2
import torch
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
import io
import base64
import os

app = FastAPI()

model_id = "IDEA-Research/grounding-dino-tiny"
device = "cuda" if torch.cuda.is_available() else "cpu"

processor = AutoProcessor.from_pretrained(model_id)
model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).to(device)

@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    keywords: str = Form(...),
    box_threshold: float = Form(0.2),
    text_threshold: float = Form(0.3)
):
    # Read image bytes and open with PIL, remove EXIF/orientation
    image_bytes = await image.read()
    pil_image = Image.open(io.BytesIO(image_bytes))
    pil_image = ImageOps.exif_transpose(pil_image)
    pil_image.info.pop("exif", None)
    # Apply CLAHE before detection
    img_np = np.array(pil_image)
    img_lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(img_lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl, a, b))
    img_clahe = cv2.cvtColor(limg, cv2.COLOR_LAB2RGB)
    pil_image = Image.fromarray(img_clahe)
    # Ensure keywords are lowercased and end with a dot
    text = keywords.strip().lower()
    if not text.endswith('.'):
        text += '.'
    inputs = processor(images=pil_image, text=text, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=[pil_image.size[::-1]]
    )
    # Save ROIs to files and prepare response
    roi_dir = "roi_images"
    os.makedirs(roi_dir, exist_ok=True)
    detections = []
    for idx, (box, label, score) in enumerate(zip(
        results[0]["boxes"].cpu().tolist(),
        results[0]["labels"],
        results[0]["scores"].cpu().tolist()
    )):
        # Update label to include score
        detections.append({
            "box": box,
            "label": f"{label} ({score:.2f})",
            "score": score,
            # "roi": roi_b64,
            # "roi_url": roi_url
        })
    return_data = {"detections": detections}
    print("Detect API result:", return_data)  # Debug print
    return JSONResponse(content=return_data)

def compute_area(box):
    xmin, ymin, xmax, ymax = box
    return max(0, xmax - xmin) * max(0, ymax - ymin)

def iou(box1, box2):
    x1_min, y1_min, x1_max, y1_max = box1
    x2_min, y2_min, x2_max, y2_max = box2
    xi1 = max(x1_min, x2_min)
    yi1 = max(y1_min, y2_min)
    xi2 = min(x1_max, x2_max)
    yi2 = min(y1_max, y2_max)  # <-- BUG: should be min(y1_max, y2_max)
    inter_width = max(0, xi2 - xi1)
    inter_height = max(0, yi2 - yi1)
    inter_area = inter_width * inter_height
    area1 = compute_area(box1)
    area2 = compute_area(box2)
    union_area = area1 + area2 - inter_area
    if union_area == 0:
        return 0
    return inter_area / union_area

# Fix: change yi2 = min(y1_max, y2_max)
def iou(box1, box2):
    x1_min, y1_min, x1_max, y1_max = box1
    x2_min, y2_min, x2_max, y2_max = box2
    xi1 = max(x1_min, x2_min)
    yi1 = max(y1_min, y2_min)
    xi2 = min(x1_max, x2_max)
    yi2 = min(y1_max, y2_max)  # <-- incorrect
    # Corrected:
    yi2 = min(y1_max, y2_max)
    inter_width = max(0, xi2 - xi1)
    inter_height = max(0, yi2 - yi1)
    inter_area = inter_width * inter_height
    area1 = compute_area(box1)
    area2 = compute_area(box2)
    union_area = area1 + area2 - inter_area
    if union_area == 0:
        return 0
    return inter_area / union_area

def filter_non_overlapping_biggest_rois(detections, iou_threshold=0.1):
    # Sort by area descending
    detections = sorted(detections, key=lambda d: compute_area(d["box"]), reverse=True)
    kept = []
    for det in detections:
        overlap = False
        for kept_det in kept:
            if iou(det["box"], kept_det["box"]) > iou_threshold:
                overlap = True
                break
        if not overlap:
            kept.append(det)
    return kept

@app.post("/embossed_detect")
async def embossed_detect(
    image: UploadFile = File(...),
    keywords: str = Form(...),
    box_threshold: float = Form(0.2),
    text_threshold: float = Form(0.3)
):
    # Read image bytes and open with PIL, remove EXIF/orientation
    image_bytes = await image.read()
    pil_image = Image.open(io.BytesIO(image_bytes))
    pil_image = ImageOps.exif_transpose(pil_image)
    pil_image.info.pop("exif", None)
    # Apply CLAHE before detection (same as /detect)
    img_np = np.array(pil_image)
    img_lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(img_lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl, a, b))
    img_clahe = cv2.cvtColor(limg, cv2.COLOR_LAB2RGB)
    pil_image = Image.fromarray(img_clahe)
    # Ensure keywords are lowercased and end with a dot
    text = keywords.strip().lower()
    if not text.endswith('.'):
        text += '.'
    inputs = processor(images=pil_image, text=text, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=[pil_image.size[::-1]]
    )
    roi_dir = "roi_images"
    os.makedirs(roi_dir, exist_ok=True)
    detections = []
    for idx, (box, label, score) in enumerate(zip(
        results[0]["boxes"].cpu().tolist(),
        results[0]["labels"],
        results[0]["scores"].cpu().tolist()
    )):
        detections.append({
            "box": box,
            "label": f"{label} ({score:.2f})",
            "score": score,
        })
    # Filter to keep only non-overlapping, biggest ROIs
    detections = filter_non_overlapping_biggest_rois(detections)
    return_data = {"detections": detections}
    print("Embossed Detect API result:", return_data)  # Debug print
    return JSONResponse(content=return_data)

# Serve roi_images as static files
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to ["http://localhost:8000"] for stricter security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/roi_images", StaticFiles(directory="roi_images"), name="roi_images")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("dino_api:app", host="0.0.0.0", port=8000, reload=True)

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
import numpy as np
import cv2
import torch
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
import io
import os

# Dùng cache offline từ Hugging Face Hub (nếu đã tải sẵn)
os.environ["HF_HUB_OFFLINE"] = "1"

app = FastAPI()

model_id = "IDEA-Research/grounding-dino-tiny"
device = "cuda" if torch.cuda.is_available() else "cpu"
cache_dir = "./models"

processor = AutoProcessor.from_pretrained(model_id, cache_dir=cache_dir)
model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id, cache_dir=cache_dir).to(device)
model.eval()

# ===== Utils =====
def compute_area(box):
    xmin, ymin, xmax, ymax = box
    return max(0, xmax - xmin) * max(0, ymax - ymin)

def iou(box1, box2):
    x1_min, y1_min, x1_max, y1_max = box1
    x2_min, y2_min, x2_max, y2_max = box2
    xi1 = max(x1_min, x2_min)
    yi1 = max(y1_min, y2_min)
    xi2 = min(x1_max, x2_max)
    yi2 = min(y1_max, y2_max)
    inter_w = max(0, xi2 - xi1)
    inter_h = max(0, yi2 - yi1)
    inter = inter_w * inter_h
    area1 = compute_area(box1)
    area2 = compute_area(box2)
    union = area1 + area2 - inter
    return 0 if union == 0 else inter / union

def filter_non_overlapping_biggest_rois(detections, iou_threshold=0.1):
    # Sort by area desc, giữ bbox to, loại bớt bbox chồng lấn
    detections = sorted(detections, key=lambda d: compute_area(d["box"]), reverse=True)
    kept = []
    for det in detections:
        if all(iou(det["box"], k["box"]) <= iou_threshold for k in kept):
            kept.append(det)
    return kept

def preprocess_keywords(keywords: str) -> str:
    text = (keywords or "").strip().lower()
    return text if text.endswith(".") else (text + ".")

def enhance_with_clahe(pil_image: Image.Image) -> Image.Image:
    img_np = np.array(pil_image)
    img_lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(img_lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl, a, b))
    img_clahe = cv2.cvtColor(limg, cv2.COLOR_LAB2RGB)
    return Image.fromarray(img_clahe)

def run_gdino(pil_image: Image.Image, text: str, box_threshold: float, text_threshold: float):
    # inputs + model forward
    inputs = processor(images=pil_image, text=text, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)

    # target_sizes cần (H, W)
    target_sizes = [pil_image.size[::-1]]

    # Tương thích nhiều phiên bản transformers
    try:
        # Mới: (outputs, input_ids, box_threshold, text_threshold, target_sizes)
        results = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            box_threshold,
            text_threshold,
            target_sizes
        )
    except TypeError:
        # Cũ: (outputs, input_ids, target_sizes=None, threshold=0.5)
        # Dùng box_threshold làm threshold chung
        results = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            target_sizes,
            box_threshold
        )
    return results

# ===== Endpoints =====
@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    keywords: str = Form(...),
    box_threshold: float = Form(0.2),
    text_threshold: float = Form(0.3)
):
    # Đọc ảnh, sửa orientation, bỏ EXIF
    image_bytes = await image.read()
    pil_image = Image.open(io.BytesIO(image_bytes))
    pil_image = ImageOps.exif_transpose(pil_image)
    pil_image.info.pop("exif", None)

    # Tăng tương phản bằng CLAHE
    pil_image = enhance_with_clahe(pil_image)

    # Chuẩn hóa text
    text = preprocess_keywords(keywords)

    # Chạy GroundingDINO
    results = run_gdino(pil_image, text, box_threshold, text_threshold)

    # Trả kết quả
    detections = []
    for box, label, score in zip(
        results[0]["boxes"].cpu().tolist(),
        results[0]["labels"],
        results[0]["scores"].cpu().tolist()
    ):
        detections.append({
            "box": box,
            "label": f"{label} ({score:.2f})",
            "score": score,
        })

    return_data = {"detections": detections}
    print("Detect API result:", return_data)
    return JSONResponse(content=return_data)

@app.post("/embossed_detect")
async def embossed_detect(
    image: UploadFile = File(...),
    keywords: str = Form(...),
    box_threshold: float = Form(0.2),
    text_threshold: float = Form(0.3)
):
    # Đọc ảnh, sửa orientation, bỏ EXIF
    image_bytes = await image.read()
    pil_image = Image.open(io.BytesIO(image_bytes))
    pil_image = ImageOps.exif_transpose(pil_image)
    pil_image.info.pop("exif", None)

    # Tăng tương phản bằng CLAHE (như /detect)
    pil_image = enhance_with_clahe(pil_image)

    # Chuẩn hóa text
    text = preprocess_keywords(keywords)

    # Chạy GroundingDINO
    results = run_gdino(pil_image, text, box_threshold, text_threshold)

    # Gom kết quả
    detections = []
    for box, label, score in zip(
        results[0]["boxes"].cpu().tolist(),
        results[0]["labels"],
        results[0]["scores"].cpu().tolist()
    ):
        detections.append({
            "box": box,
            "label": f"{label} ({score:.2f})",
            "score": score,
        })

    # Lọc giữ ROI lớn, không chồng lấn
    detections = filter_non_overlapping_biggest_rois(detections)

    return_data = {"detections": detections}
    print("Embossed Detect API result:", return_data)
    return JSONResponse(content=return_data)

# ===== Static & CORS =====
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # có thể siết chặt lại domain thật sự dùng
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("roi_images", exist_ok=True)
app.mount("/roi_images", StaticFiles(directory="roi_images"), name="roi_images")

# ===== Runner =====
if __name__ == "__main__":
    import uvicorn
    # Chạy HTTP. Nếu bạn chạy bằng lệnh có --ssl-keyfile/--ssl-certfile, hãy dùng trực tiếp lệnh đó ở shell.
    uvicorn.run("dino_api:app", host="0.0.0.0", port=8000, reload=True)

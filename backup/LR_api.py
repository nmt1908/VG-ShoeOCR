import cv2
import numpy as np
from flask import Flask, request, jsonify
from PIL import Image
from io import BytesIO
import base64
from rembg import remove
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

def remove_background(image_bytes):
    output_bytes = remove(image_bytes)
    return output_bytes

def detect_contours(image):
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    _, thresh = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        largest_contour = max(contours, key=cv2.contourArea)
        return largest_contour
    return None

def is_left_shoe(contour, image_shape):
    """
    Determine if the shoe sole is left or right based on contour analysis.

    This function uses a simple heuristic:
    - It draws the shoe contour on a blank image.
    - It calculates the center of mass (cx, cy) of the contour.
    - It splits the mask into left and right halves at the center of mass (cx).
    - It compares the area (number of white pixels) in each half.
    - If the right half has more area, it is likely a left shoe (and vice versa).

    Note: This is a basic geometric approach and may not be accurate for all shoe shapes.
    """
    blank = np.zeros(image_shape[:2], dtype=np.uint8)
    cv2.drawContours(blank, [contour], 0, 255, -1)
    M = cv2.moments(contour)
    if M["m00"] != 0:
        cx = int(M["m10"] / M["m00"])
    else:
        cx = 0
    # Split the mask into left and right halves at the center x
    left_half = blank[:, :cx]
    right_half = blank[:, cx:]
    left_area = np.sum(left_half) / 255  # count white pixels in left half
    right_area = np.sum(right_half) / 255  # count white pixels in right half
    # Heuristic: if left half has less area, it's likely a left shoe
    # (because the big toe area is on the left for a left shoe)
    return left_area < right_area

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400
    file = request.files['image']
    image_bytes = file.read()

    # Remove background (keep original quality)
    output_bytes = remove_background(image_bytes)
    pil_img = Image.open(BytesIO(output_bytes))
    img = np.array(pil_img)
    # No resize here, keep original size

    # --- Call md_detect API ---
    md_detect_url = "http://10.13.33.50:5000/md_detect"
    files = {
        'image': ('image.png', output_bytes, 'image/png')
    }
    data = {
        'object_name': request.form.get('object_name', 'yellow printed text')
    }
    try:
        md_resp = requests.post(md_detect_url, files=files, data=data, timeout=10)
        md_resp.raise_for_status()
        md_json = md_resp.json()
        objects = md_json.get("objects", [])
    except Exception as e:
        objects = []
    
    roi_b64 = None
    ocr_text = None
    if objects:
        obj = objects[0]
        x_min = obj["x_min"]
        y_min = obj["y_min"]
        x_max = obj["x_max"]
        y_max = obj["y_max"]
        h, w = img.shape[:2]
        # Tính toạ độ pixel, giống như printed_text_extracting.html
        x1 = int(x_min * w)
        y1 = int(y_min * h)
        x2 = int(x_max * w)
        y2 = int(y_max * h)
        # Đảm bảo không vượt ngoài ảnh
        x1 = max(0, min(x1, w-1))
        x2 = max(0, min(x2, w))
        y1 = max(0, min(y1, h-1))
        y2 = max(0, min(y2, h))
        roi = img[y1:y2, x1:x2]

        # --- Xử lý ROI như printed_text_extracting.html ---
        overlap = 15
        sh, sw = roi.shape[0], roi.shape[1]
        halfH = sh // 2
        upper_end = min(sh, halfH + overlap)
        upper = roi[0:upper_end, :]
        lower_start = max(0, halfH - overlap)
        lower = roi[lower_start:sh, :]
        joined = np.zeros((max(upper.shape[0], lower.shape[0]), sw * 2, roi.shape[2]), dtype=roi.dtype)
        joined[:upper.shape[0], :sw] = upper
        joined[:lower.shape[0], sw:sw*2] = lower

        # Encode joined ROI thành base64
        joined_pil = Image.fromarray(joined)
        buffered = BytesIO()
        joined_pil.save(buffered, format="PNG")
        roi_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

        # --- Gửi joined_pil lên sole_inkjet_ocr ---
        ocr_url = "http://10.13.33.50:5000/sole_inkjet_ocr"
        ocr_files = {
            'image': ('inkjet.png', buffered.getvalue(), 'image/png')
        }
        ocr_data = {
            'model_name': 'parseq'
        }
        try:
            ocr_resp = requests.post(ocr_url, files=ocr_files, data=ocr_data, timeout=10)
            ocr_resp.raise_for_status()
            ocr_json = ocr_resp.json()
            ocr_text = ocr_json.get("text")
        except Exception as e:
            ocr_text = None

    # Convert to BGR for OpenCV
    if len(img.shape) == 3 and img.shape[2] == 4:
        img_bgr = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    else:
        img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    # Detect contour
    contour = detect_contours(img_bgr)
    if contour is None:
        return jsonify({'error': 'No contour found'}), 400
    side = "L" if is_left_shoe(contour, img_bgr.shape) else "R"

    return jsonify({
        "side": side,
        "roi_base64": roi_b64,
        "text": ocr_text
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
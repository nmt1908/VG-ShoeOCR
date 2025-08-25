import cv2
import numpy as np
from flask import Flask, request, jsonify
from PIL import Image
from io import BytesIO
import base64
from rembg import remove
from flask_cors import CORS

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
    blank = np.zeros(image_shape[:2], dtype=np.uint8)
    cv2.drawContours(blank, [contour], 0, 255, -1)
    M = cv2.moments(contour)
    if M["m00"] != 0:
        cx = int(M["m10"] / M["m00"])
    else:
        cx = 0
    left_half = blank[:, :cx]
    right_half = blank[:, cx:]
    left_area = np.sum(left_half) / 255
    right_area = np.sum(right_half) / 255
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
    # --- Resize về width=800px, giữ nguyên tỉ lệ ---
    w, h = pil_img.size
    if w != 800:
        new_h = int(h * 800 / w)
        pil_img = pil_img.resize((800, new_h), Image.LANCZOS)
    img = np.array(pil_img)
    # No resize here, keep original size

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
    # # Encode removed background image to base64 PNG
    # pil_removed = Image.fromarray(img)
    # buffered_removed = BytesIO()
    # pil_removed.save(buffered_removed, format="PNG")
    # removed_base64 = base64.b64encode(buffered_removed.getvalue()).decode('utf-8')

    return jsonify({
        "side": side
        
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)

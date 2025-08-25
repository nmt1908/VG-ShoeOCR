from flask import Flask, request, send_file, jsonify, render_template_string, send_from_directory
from flask_cors import CORS
from PIL import Image, ImageOps
import io
import os
import cv2
import numpy as np
from rembg import remove
import psycopg2
import requests  # Đảm bảo đã import requests

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
ROI_CONFIG = 'roi-config.txt'
HTML_FILE = 'roi-cropper.html'
SIDE_DETECT_ROI_CONFIG = 'side_detect_roi.txt'

DB_CONFIG = {
    'dbname': 'f3_iot',
    'user': 'postgres',
    'port': '5432',
    'host': '10.1.22.154',
    'password': 'abcd@1234',
}

# Đảm bảo thư mục uploads tồn tại
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def read_roi():
    roi = {}
    try:
        with open(ROI_CONFIG, 'r') as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=')
                    roi[k.strip()] = float(v.strip())
    except Exception:
        roi = {'x': 0, 'y': 0, 'w': 100, 'h': 100}
    return roi

def write_roi(roi):
    with open(ROI_CONFIG, 'w') as f:
        for k in ['x', 'y', 'w', 'h']:
            f.write(f"{k}={roi[k]}\n")

def write_side_detect_roi(roi):
    with open(SIDE_DETECT_ROI_CONFIG, 'w') as f:
        for k in ['x', 'y', 'w', 'h']:
            f.write(f"{k}={roi[k]}\n")

@app.route('/')
def index():
    # Phục vụ HTML trực tiếp từ file
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        return render_template_string(f.read())

@app.route('/upload', methods=['POST'])
def upload_image():
    file = request.files.get('image')
    if not file:
        return jsonify({'error': 'No image uploaded'}), 400
    # Đọc nội dung file vào bộ nhớ, không lưu ra thư mục uploads
    file_bytes = file.read()
    # Trả về dữ liệu file dưới dạng hex cho client
    return jsonify({'filename': file.filename, 'filedata': file_bytes.hex()})

@app.route('/roi', methods=['GET', 'POST'])
def roi_config():
    if request.method == 'GET':
        roi = read_roi()
        return jsonify(roi)
    else:
        data = request.json
        roi = {k: float(data[k]) for k in ['x', 'y', 'w', 'h']}
        write_roi(roi)
        return jsonify({'status': 'saved', 'roi': roi})

@app.route('/save-side-detect-roi', methods=['POST'])
def save_side_detect_roi():
    data = request.json
    roi = {k: float(data[k]) for k in ['x', 'y', 'w', 'h']}
    write_side_detect_roi(roi)
    return jsonify({'status': 'saved', 'side_detect_roi': roi})

@app.route('/crop', methods=['POST'])
def crop_image():
    data = request.json
    file_hex = data.get('filedata')
    roi_data = data.get('roi')
    scale = float(data.get('scale', 1.0))
    # Nếu không có file_hex thì trả về lỗi 400
    if not file_hex or len(file_hex) < 2:
        return jsonify({'error': 'No image data'}), 400
    try:
        file_bytes = bytes.fromhex(file_hex)
        img = Image.open(io.BytesIO(file_bytes))
        img = ImageOps.exif_transpose(img)
        # Chuyển đổi ROI từ canvas về ảnh gốc
        if roi_data:
            x = int(round(roi_data['x'] / scale))
            y = int(round(roi_data['y'] / scale))
            w = int(round(roi_data['w'] / scale))
            h = int(round(roi_data['h'] / scale))
        else:
            roi = read_roi()
            x, y, w, h = int(roi['x']), int(roi['y']), int(roi['w']), int(roi['h'])
        x = max(0, min(x, img.width-1))
        y = max(0, min(y, img.height-1))
        w = max(1, min(w, img.width-x))
        h = max(1, min(h, img.height-y))
        cropped = img.crop((x, y, x + w, y + h))

        # Convert PIL image to numpy array
        cropped_np = np.array(cropped)
        # Convert to grayscale
        if cropped_np.ndim == 3:
            gray = cv2.cvtColor(cropped_np, cv2.COLOR_RGB2GRAY)
        else:
            gray = cropped_np
        # Apply CLAHE
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)
        # Convert back to PIL image
        result_img = Image.fromarray(enhanced)
        buf = io.BytesIO()
        result_img.save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception as ex:
        # Trả về lỗi chi tiết để debug phía client
        return jsonify({'error': f'Image decode/crop failed: {str(ex)}'}), 400

def fetch_distinct_mold_data():
    dictionary = set()
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        # Lấy mold_id
        cur.execute("SELECT DISTINCT mold_id FROM mold_data WHERE mold_id IS NOT NULL;")
        for row in cur.fetchall():
            if row[0] is not None:
                dictionary.add(str(row[0]))
        # Lấy mold_ip
        cur.execute("SELECT DISTINCT mold_ip FROM mold_data WHERE mold_ip IS NOT NULL;")
        for row in cur.fetchall():
            if row[0] is not None:
                dictionary.add(str(row[0]))
        # Lấy size với điều kiện mold_id NOT LIKE '%-%'
        cur.execute("""
            SELECT DISTINCT size
            FROM mold_data
            WHERE mold_id IS NOT NULL;

        """)
        for row in cur.fetchall():
            if row[0] is not None:
                dictionary.add(str(row[0]))
        # Thêm: Lấy mold_shift_l, mold_shift_r
        cur.execute("""
            SELECT DISTINCT mold_shift_l, mold_shift_r
            FROM mold_data
            WHERE mold_id IS NOT NULL;
        """)
        for row in cur.fetchall():
            if row[0] is not None:
                dictionary.add(str(row[0]))
            if row[1] is not None:
                dictionary.add(str(row[1]))
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error:", ex)
    return list(dictionary)

@app.route('/fetch-dictionary', methods=['GET'])
def fetch_dictionary():
    dictionary = fetch_distinct_mold_data()
    return jsonify({'dictionary': dictionary})

@app.route('/fetch-moldip-for-line1', methods=['POST'])
def fetch_moldip_for_line1():
    data = request.json
    mold_id = data.get('mold_id', '').strip()
    size = data.get('size', [])
    shift = data.get('shift', '').strip()
    side = data.get('side', '').strip()  # <-- thêm lấy side

    # Đảm bảo size là list (nếu truyền lên là string thì chuyển thành list)
    if isinstance(size, str):
        size = [size]
    if not isinstance(size, list):
        size = []

    mold_ip_set = set()
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        # Truy vấn mold_ip theo các điều kiện, cho phép size là mảng
        # Nếu size rỗng thì bỏ qua điều kiện size
        if size:
            # Tạo placeholders cho size list
            size_placeholders = ','.join(['%s'] * len(size))
            query = f"""
                SELECT DISTINCT mold_ip
                FROM mold_data
                WHERE
                    (%s = '' OR mold_id = %s)
                    AND (size IN ({size_placeholders}))
                    AND (
                        %s = ''
                        OR mold_shift_l = %s
                        OR mold_shift_r = %s
                    )
                    AND (%s = '' OR side = %s)
                    AND mold_ip IS NOT NULL
            """
            params = [mold_id, mold_id] + size + [shift, shift, shift, side, side]
            cur.execute(query, params)
        else:
            query = """
                SELECT DISTINCT mold_ip
                FROM mold_data
                WHERE
                    (%s = '' OR mold_id = %s)
                    AND (%s = '' OR size = %s)
                    AND (
                        %s = ''
                        OR mold_shift_l = %s
                        OR mold_shift_r = %s
                    )
                    AND (%s = '' OR side = %s)
                    AND mold_ip IS NOT NULL
            """
            params = [mold_id, mold_id, '', '', shift, shift, shift, side, side]
            cur.execute(query, params)
        for row in cur.fetchall():
            if row[0] is not None:
                mold_ip_set.add(str(row[0]))
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error:", ex)
        return jsonify({'error': str(ex)}), 500
    return jsonify({'mold_ip_list': list(mold_ip_set)})

# --- Hàm xử lý từ LR_api.py ---
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

# @app.route('/leftRightDetection', methods=['POST'])
# def analyze():
#     if 'image' not in request.files:
#         return jsonify({'error': 'No image uploaded'}), 400
#     file = request.files['image']
#     image_bytes = file.read()

#     # Remove background
#     output_bytes = remove_background(image_bytes)
#     pil_img = Image.open(io.BytesIO(output_bytes))
#     # Resize về width=800px, giữ nguyên tỉ lệ
#     w, h = pil_img.size
#     if w != 800:
#         new_h = int(h * 800 / w)
#         pil_img = pil_img.resize((800, new_h), Image.LANCZOS)
#     img = np.array(pil_img)

#     # Convert to BGR for OpenCV
#     if len(img.shape) == 3 and img.shape[2] == 4:
#         img_bgr = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
#     else:
#         img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
#     # Detect contour
#     contour = detect_contours(img_bgr)
#     if contour is None:
#         return jsonify({'error': 'No contour found'}), 400
#     side = "L" if is_left_shoe(contour, img_bgr.shape) else "R"

#     return jsonify({
#         "side": side
#     })

# --- Logic xử lý từ LR_api.py ---
@app.route('/leftRightDetection', methods=['POST'])
def analyze_lr_api():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400
    file = request.files['image']
    image_bytes = file.read()

    # Remove background (keep original quality)
    output_bytes = remove_background(image_bytes)
    pil_img = Image.open(io.BytesIO(output_bytes))
    img = np.array(pil_img)
    # Không resize, giữ nguyên kích thước gốc

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
        # Tính toạ độ pixel
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
        buffered = io.BytesIO()
        joined_pil.save(buffered, format="PNG")
        import base64
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

@app.route('/side_detect_roi.txt')
def get_side_detect_roi_txt():
    # Trả về file side_detect_roi.txt từ thư mục hiện tại
    return send_from_directory('.', 'side_detect_roi.txt')
@app.route('/roi-config.txt')
def get_roi_config_txt():
    return send_from_directory('.', 'roi-config.txt')

if __name__ == '__main__':
    app.run(debug=True)
    app.run(debug=True)

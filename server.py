from flask import Flask, request, send_file, jsonify, render_template_string, send_from_directory
from flask_cors import CORS
from PIL import Image, ImageOps
import io
import os
import cv2
import datetime
import numpy as np
from rembg import remove
import psycopg2
import math
import requests  # Đảm bảo đã import requests
from werkzeug.utils import secure_filename
import json
from collections import Counter
# from flask_socketio import SocketIO, emit
import time
import threading
app = Flask(__name__)
CORS(app)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MOLD_ROI_DIR = os.path.join(BASE_DIR, 'mold_ROI')
os.makedirs(MOLD_ROI_DIR, exist_ok=True)
BASE_DIR2 = os.path.dirname(os.path.abspath(__file__))
INJET_ROI_DIR = os.path.join(BASE_DIR2, 'injet_ROI')  # dùng đúng tên "injet_ROI" theo yêu cầu
os.makedirs(INJET_ROI_DIR, exist_ok=True)
# --- Khởi tạo SocketIO ---
# socketio = SocketIO(app, cors_allowed_origins="*")

UPLOAD_FOLDER = 'static/uploads'
UPLOAD_FOLDER_MOBILE = 'uploads'
ROI_CONFIG = 'roi-config.txt'
HTML_FILE = 'roi-cropper.html'
SIDE_DETECT_ROI_CONFIG = 'side_detect_roi.txt'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

DB_CONFIG = {
    'dbname': 'f3_iot',
    'user': 'postgres',
    'port': '5432',
    'host': '10.1.22.154',
    'password': 'abcd@1234',
}

PROMPT_TEMPLATE_PATH = os.path.join('static', 'prompt_template.md')

# Đảm bảo thư mục uploads tồn tại
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
os.makedirs(UPLOAD_FOLDER_MOBILE, exist_ok=True)

app.config['UPLOAD_FOLDER_MOBILE'] = UPLOAD_FOLDER_MOBILE

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

    if not file_hex or len(file_hex) < 2:
        return jsonify({'error': 'No image data'}), 400

    try:
        # Decode ảnh đầu vào
        file_bytes = bytes.fromhex(file_hex)
        img = Image.open(io.BytesIO(file_bytes))
        img = ImageOps.exif_transpose(img)

        # Lấy ROI (từ client hoặc từ file config)
        if roi_data:
            x = int(round(roi_data['x'] / scale))
            y = int(round(roi_data['y'] / scale))
            w = int(round(roi_data['w'] / scale))
            h = int(round(roi_data['h'] / scale))
        else:
            roi = read_roi()
            x, y, w, h = int(roi['x']), int(roi['y']), int(roi['w']), int(roi['h'])

        # Clamp ROI trong biên ảnh
        x = max(0, min(x, img.width - 1))
        y = max(0, min(y, img.height - 1))
        w = max(1, min(w, img.width - x))
        h = max(1, min(h, img.height - y))

        # Crop
        cropped = img.crop((x, y, x + w, y + h))

        # Giới hạn chiều cao tối đa
        max_h = 220  # (comment trước ghi 320, nhưng đang dùng 200)
        if cropped.height > max_h:
            cropped = cropped.crop((0, 0, cropped.width, max_h))

        # Grayscale + CLAHE
        cropped_np = np.array(cropped)
        if cropped_np.ndim == 3:
            gray = cv2.cvtColor(cropped_np, cv2.COLOR_RGB2GRAY)
        else:
            gray = cropped_np

        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        result_img = Image.fromarray(enhanced)

        # ----- LƯU FILE VÀO mold_ROI CÙNG CẤP VỚI server.py -----
        ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        filename = f'roi_{ts}.png'
        save_path = os.path.join(MOLD_ROI_DIR, filename)
        result_img.save(save_path, format='PNG')

        # Trả về file để client dùng ngay (và đồng thời file đã được lưu ở server)
        return send_file(save_path, mimetype='image/png')

        # Hoặc nếu bạn muốn trả JSON thay vì ảnh:
        # return jsonify({
        #     'message': 'Cropped image saved.',
        #     'filename': filename,
        #     'saved_path': save_path
        # })

    except Exception as ex:
        return jsonify({'error': f'Image decode/crop failed: {str(ex)}'}), 400


def fetch_distinct_mold_data():
    dictionary = set()
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        # Lấy mold_id
        # cur.execute("SELECT DISTINCT mold_id FROM bdts_tooling_form_tbl WHERE mold_id IS NOT NULL;")
        # for row in cur.fetchall():
        #     if row[0] is not None:
        #         dictionary.add(str(row[0]))
        # Lấy mold_ip
        cur.execute("SELECT DISTINCT nike_tool_code FROM bdts_tooling_form_tbl WHERE nike_tool_code IS NOT NULL;")
        for row in cur.fetchall():
            if row[0] is not None:
                dictionary.add(str(row[0]))
        # Lấy size với điều kiện mold_id NOT LIKE '%-%'
        cur.execute("""
            SELECT DISTINCT component_size
            FROM bdts_tooling_form_tbl
            WHERE component_size IS NOT NULL;

        """)
        for row in cur.fetchall():
            if row[0] is not None:
                dictionary.add(str(row[0]))
        # Thêm: Lấy mold_shift_l, mold_shift_r
        cur.execute("""
            SELECT DISTINCT mold_name
            FROM bdts_tooling_form_tbl
            WHERE mold_name IS NOT NULL;
        """)
        for (val,) in cur.fetchall():
            dictionary.add(str(val))
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
# def fetch_moldip_for_line1():
#     data = request.json
#     mold_id = data.get('mold_id', '').strip()
#     size = data.get('size', [])
#     shift = data.get('shift', '').strip()
#     side = data.get('side', '').strip()  # <-- thêm lấy side

#     # Đảm bảo size là list (nếu truyền lên là string thì chuyển thành list)
#     if isinstance(size, str):
#         size = [size]
#     if not isinstance(size, list):
#         size = []

#     mold_ip_set = set()
#     try:
#         conn = psycopg2.connect(**DB_CONFIG)
#         cur = conn.cursor()
#         # Truy vấn mold_ip theo các điều kiện, cho phép size là mảng
#         # Nếu size rỗng thì bỏ qua điều kiện size
#         if size:
#             # Tạo placeholders cho size list
#             size_placeholders = ','.join(['%s'] * len(size))
#             query = f"""
#                 SELECT DISTINCT mold_ip
#                 FROM mold_data
#                 WHERE
#                     (%s = '' OR mold_id = %s)
#                     AND (size IN ({size_placeholders}))
#                     AND (
#                         %s = ''
#                         OR mold_shift_l = %s
#                         OR mold_shift_r = %s
#                     )
#                     AND (%s = '' OR side = %s)
#                     AND mold_ip IS NOT NULL
#             """
#             params = [mold_id, mold_id] + size + [shift, shift, shift, side, side]
#             cur.execute(query, params)
#         else:
#             query = """
#                 SELECT DISTINCT mold_ip
#                 FROM mold_data
#                 WHERE
#                     (%s = '' OR mold_id = %s)
#                     AND (%s = '' OR size = %s)
#                     AND (
#                         %s = ''
#                         OR mold_shift_l = %s
#                         OR mold_shift_r = %s
#                     )
#                     AND (%s = '' OR side = %s)
#                     AND mold_ip IS NOT NULL
#             """
#             params = [mold_id, mold_id, '', '', shift, shift, shift, side, side]
#             cur.execute(query, params)
#         for row in cur.fetchall():
#             if row[0] is not None:
#                 mold_ip_set.add(str(row[0]))
#         cur.close()
#         conn.close()
#     except Exception as ex:
#         print("DB error:", ex)
#         return jsonify({'error': str(ex)}), 500
#     return jsonify({'mold_ip_list': list(mold_ip_set)})
def fetch_moldip_for_line1():
    data = request.get_json(silent=True) or {}

    # Map payload mới
    nike_tool_code = (data.get('nike_tool_code') or '').strip()
    mold_name = (data.get('mold_name') or '').strip()

    # component_size có thể là string hoặc list -> chuẩn hoá thành list[str]
    comp_size = data.get('component_size', [])
    if isinstance(comp_size, str):
        comp_size = [comp_size]
    if not isinstance(comp_size, list):
        comp_size = []
    # ép tất cả về str và strip
    comp_size = [str(s).strip() for s in comp_size if s is not None]

    # Query: optional filter cho cả 3 trường, chỉ lấy DISTINCT mold_id
    sql = """
        SELECT DISTINCT mold_id
        FROM bdts_tooling_form_tbl
        WHERE (%s = '' OR nike_tool_code = %s)
          AND (cardinality(%s::varchar[]) = 0 OR component_size = ANY(%s::varchar[]))
          AND (%s = '' OR mold_name = %s)
          AND mold_id IS NOT NULL
    """

    params = [
        nike_tool_code, nike_tool_code,
        comp_size, comp_size,
        mold_name, mold_name
    ]

    mold_ids = set()
    conn = None
    cur = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute(sql, params)
        for (mid,) in cur.fetchall():
            if mid:
                mold_ids.add(str(mid))
    except Exception as ex:
        print("DB error:", ex)
        return jsonify({'error': str(ex)}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()

    # trả về danh sách mold_id duy nhất (đã sort cho ổn định)
    return jsonify({'mold_ip_list': sorted(mold_ids)})


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
        ocr_url = "http://10.13.32.51:8000/sole_inkjet_ocr"
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
@app.route('/ocrOnly', methods=['POST'])
def ocr_only():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400
    
    file = request.files['image']
    image_bytes = file.read()

    # ----- LƯU ẢNH VÀO injet_ROI -----
    # Lấy tên file gốc an toàn + gắn timestamp để tránh trùng
    original_name = secure_filename(file.filename or 'image.png')
    base, ext = os.path.splitext(original_name)
    if not ext:
        ext = '.png'  # fallback khi không có đuôi
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    saved_name = f"{base}_{ts}{ext}"
    saved_path = os.path.join(INJET_ROI_DIR, saved_name)

    try:
        with open(saved_path, 'wb') as f:
            f.write(image_bytes)
    except Exception as e:
        return jsonify({'error': 'Failed to save image', 'details': str(e)}), 500

    # ----- GỬI ẢNH LÊN OCR API -----
    ocr_url = "http://10.13.32.51:8001/sole_inkjet_ocr"
    ocr_files = {
        'image': ('image.png', image_bytes, 'image/png')
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
        return jsonify({'error': 'OCR request failed', 'details': str(e)}), 500

    # Giữ nguyên schema cũ: chỉ trả về text
    return jsonify({
        "text": ocr_text
        # Nếu muốn biết thêm file đã lưu, có thể thêm:
        # , "saved_filename": saved_name
        # , "saved_path": saved_path
    })

@app.route('/side_detect_roi.txt')
def get_side_detect_roi_txt():
    # Trả về file side_detect_roi.txt từ thư mục hiện tại
    return send_from_directory('.', 'side_detect_roi.txt')
@app.route('/roi-config.txt')
def get_roi_config_txt():
    return send_from_directory('.', 'roi-config.txt')

def fetch_example_line1():
    examples = []
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT mold_ip FROM mold_data_example_ocr_app_tbl WHERE mold_ip IS NOT NULL;")
        for row in cur.fetchall():
            val = row[0]
            if val:
                examples.append(val.strip())
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error (fetch_example_line1):", ex)
    return examples

def fetch_example_line2():
    examples = []
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT mold_id FROM mold_data_example_ocr_app_tbl WHERE mold_id IS NOT NULL;")
        for row in cur.fetchall():
            val = row[0]
            if val:
                examples.append(val.strip())
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error (fetch_example_line2):", ex)
    return examples

def fetch_line3_examples():
    examples = []
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT line3 FROM mold_data_example_ocr_app_tbl WHERE line3 IS NOT NULL;")
        for row in cur.fetchall():
            val = row[0]
            if val:
                examples.append(val.strip())
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error (fetch_line3_examples):", ex)
    return examples

@app.route('/static/prompt.md')
def serve_prompt_md():
    try:
        with open(PROMPT_TEMPLATE_PATH, 'r', encoding='utf-8') as f:
            template = f.read()
    except Exception as ex:
        return f"Error reading prompt template: {ex}", 500

    # Fetch examples for line1, line2, line3
    examples_line1 = fetch_example_line1()
    examples_line2 = fetch_example_line2()
    examples_line3 = fetch_line3_examples()
    example_line1 = "* Examples: " + ", ".join(f'"{e}"' for e in examples_line1)
    example_line2 = "* Examples: " + ", ".join(f'"{e}"' for e in examples_line2)
    example_line3 = "* Examples: " + ", ".join(f'"{e}"' for e in examples_line3)

    prompt_txt = (
        template
        .replace('{{EXAMPLE_LINE1}}', example_line1)
        .replace('{{EXAMPLE_LINE2}}', example_line2)
        .replace('{{EXAMPLE_LINE3}}', example_line3)
    )
    return prompt_txt, 200, {'Content-Type': 'text/plain; charset=utf-8'}

@app.route('/add-example', methods=['POST'])
def add_example():
    data = request.json
    if not data:
        return jsonify({'error': 'No data'}), 400
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        if 'mold_ip' in data:
            cur.execute("INSERT INTO mold_data_example_ocr_app_tbl (mold_ip) VALUES (%s)", (data['mold_ip'],))
        elif 'mold_id' in data:
            cur.execute("INSERT INTO mold_data_example_ocr_app_tbl (mold_id) VALUES (%s)", (data['mold_id'],))
        elif 'line3' in data:
            cur.execute("INSERT INTO mold_data_example_ocr_app_tbl (line3) VALUES (%s)", (data['line3'],))
        else:
            cur.close()
            conn.close()
            return jsonify({'error': 'Invalid field'}), 400
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'status': 'ok'})
    except Exception as ex:
        return jsonify({'error': str(ex)}), 500
def remove_exif_and_fix_orientation(input_path, output_path):
    with Image.open(input_path) as img:
        img = ImageOps.exif_transpose(img)  # tự xoay nếu có orientation
        img.save(output_path, format='JPEG', quality=95)  # không EXIF

@app.route('/uploadMobile', methods=['POST'])
def upload_file_mobile():
    if 'file' not in request.files:
        return 'No image file', 400

    file = request.files['file']
    if file.filename == '':
        return 'No selected file', 400

    device_id = request.form.get('device_id') or 'unknown'
    timestamp = int(time.time())
    raw_filename = secure_filename(f"raw_{device_id}_{timestamp}.jpg")
    clean_filename = secure_filename(f"{device_id}_{timestamp}.jpg")

    raw_path = os.path.join(UPLOAD_FOLDER, raw_filename)
    clean_path = os.path.join(UPLOAD_FOLDER, clean_filename)

    # Bước 1: Lưu ảnh gốc (tạm)
    file.save(raw_path)

    # Bước 2: Xử lý EXIF và xoay đúng chiều
    try:
        remove_exif_and_fix_orientation(raw_path, clean_path)
    except Exception as e:
        print(f"❌ Lỗi xử lý ảnh: {e}")
        return 'Image processing failed', 500

    # Bước 3: Xoá ảnh gốc
    if os.path.exists(raw_path):
        os.remove(raw_path)

    # Bước 4: Gửi socket
    socketio.emit('image_uploaded', {
        'device_id': device_id,
        'image_url': f'/static/uploads/{clean_filename}'
    })

    return 'OK', 200
# @app.route('/uploadMobile', methods=['POST'])
# def upload_file_mobile():
#     if 'file' not in request.files:
#         return 'No file part', 400
#     file = request.files['file']
#     if file.filename == '':
#         return 'No selected file', 400
#     filename = secure_filename(file.filename)
#     file.save(os.path.join(app.config['UPLOAD_FOLDER_MOBILE'], filename))
#     return 'File uploaded', 200

@app.route('/uploadsMobile/<filename>')
def uploaded_file_mobile(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER_MOBILE'], filename)

@app.route('/imagesMobile', methods=['GET'])
def list_images_mobile():
    files = os.listdir(app.config['UPLOAD_FOLDER_MOBILE'])
    images = [f"/uploadsMobile/{f}" for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif'))]
    return jsonify(images)

def fetch_button_color_data():
    results = []
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            SELECT id, label, color_code, color_text, description
            FROM color_buttons
            ORDER BY id
        """)
        for row in cur.fetchall():
            results.append({
                'id': row[0],
                'label': row[1],
                'color_code': row[2],
                'color_text': row[3],
                'description': row[4]
            })
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error (fetch_button_color_data):", ex)
    return results


@app.route('/fetch-button-data', methods=['GET'])
def fetch_button_data():
    data = fetch_button_color_data()
    return jsonify({'buttons': data})
@app.route('/trigger-capture')
def trigger_capture():
    device_id = request.args.get('device_id')
    if not device_id:
        return "Missing device_id", 400
    sid = connected_devices.get(device_id)
    if sid:
        socketio.emit('trigger_capture', {}, to=sid)
        print(f"Sent trigger_capture to {device_id}")
        return f"✅ Lệnh chụp đã gửi tới {device_id}"
    else:
        return f"❌ Thiết bị {device_id} chưa kết nối", 404
# --- WebSocket handlers ---
# connected_devices = {}

# @socketio.on('connect')
# def on_connect():
#     print("Client connected:", request.sid)
#     # Gửi danh sách device_id đang online cho client mới
#     emit('device_connected', list(connected_devices.keys()))

# @socketio.on('disconnect')
# def on_disconnect():
#     print("Client disconnected:", request.sid)
#     for k, v in list(connected_devices.items()):
#         if v == request.sid:
#             del connected_devices[k]
#     # Broadcast danh sách device_id mới cho tất cả client
#     socketio.emit('device_connected', list(connected_devices.keys()))

# @socketio.on('register_device')
# def on_register_device(data):
#     print("🧪 Kiểu dữ liệu nhận được từ client:", type(data))
#     print("📥 Dữ liệu raw:", data)
#     device_id = data.get("device_id")
#     if device_id:
#         connected_devices[device_id] = request.sid
#         print(f"Device {device_id} registered with SID {request.sid}")
#         # Broadcast danh sách device_id mới cho tất cả client
#         socketio.emit('device_connected', list(connected_devices.keys()))

# @socketio.on('capture_photo')
# def on_capture_photo(data):
#     device_id = data.get("device_id")
#     sid = connected_devices.get(device_id)
#     if sid:
#         emit('trigger_capture', {}, to=sid)
#         print(f"Sent trigger_capture to {device_id}")
#     else:
#         print(f"Device {device_id} not connected.")
def auto_delete_old_images(folder, max_age_seconds=10, interval=10):
    while True:
        try:
            now = time.time()
            for filename in os.listdir(folder):
                file_path = os.path.join(folder, filename)
                if os.path.isfile(file_path):
                    file_age = now - os.path.getmtime(file_path)
                    if file_age > max_age_seconds:
                        os.remove(file_path)
                        print(f"🗑️ Deleted old file: {filename}")
        except Exception as e:
            print(f"❌ Error in auto_delete_old_images: {e}")
        time.sleep(interval)
@app.route('/fetch-color-way', methods=['POST'])
def fetch_color_way():
    data = request.json or {}

    mold_id = data.get('mold_id', '').strip()
    mold_ip = data.get('mold_ip', '').strip()
    size_list = data.get('size', [])
    side = data.get('side', '').strip()
    shift = data.get('shift', '').strip()

    # Đảm bảo size là list
    if isinstance(size_list, str):
        size_list = [size_list]
    if not isinstance(size_list, list):
        size_list = []

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        base_query = """
        SELECT DISTINCT ON (color_way) color_way, updated_at
        FROM mold_data
        WHERE 
            (%s = '' OR mold_id = %s)
            AND (%s = '' OR mold_ip = %s)
            {size_clause}
            AND (%s = '' OR side = %s)
            AND (
                %s = ''
                OR %s = ANY(ARRAY[mold_shift_l, mold_shift_r])
            )
            AND updated_at >= NOW() - INTERVAL '7 days'
        ORDER BY color_way, updated_at DESC
        LIMIT 5
        """

        fallback_query = """
        SELECT color_way, updated_at
        FROM mold_data
        WHERE 
            (%s = '' OR mold_id = %s)
            AND (%s = '' OR mold_ip = %s)
            {size_clause}
            AND (%s = '' OR side = %s)
            AND (
                %s = ''
                OR %s = ANY(ARRAY[mold_shift_l, mold_shift_r])
            )
        ORDER BY updated_at DESC
        LIMIT 1
        """

        # Tùy theo có size hay không, chèn vào query phù hợp
        if size_list:
            size_placeholders = ','.join(['%s'] * len(size_list))
            size_clause = f"AND (size IN ({size_placeholders}))"
        else:
            size_clause = ""

        # Tạo query hoàn chỉnh
        query = f"""
        WITH recent_color_way AS (
            {base_query.format(size_clause=size_clause)}
        ),
        fallback_color_way AS (
            {fallback_query.format(size_clause=size_clause)}
        )
        SELECT color_way FROM recent_color_way
        UNION ALL
        SELECT color_way FROM fallback_color_way
        WHERE NOT EXISTS (SELECT 1 FROM recent_color_way);
        """

        # Tạo danh sách tham số cho query
        def build_params():
            base_params = [mold_id, mold_id, mold_ip, mold_ip]
            if size_list:
                base_params += size_list
            base_params += [side, side, shift, shift]
            return base_params * 2  # recent + fallback

        cur.execute(query, build_params())
        rows = cur.fetchall()
        color_ways = [row[0] for row in rows]

        cur.close()
        conn.close()
        return jsonify({'color_ways': color_ways})

    except Exception as e:
        print(f"DB error (fetch_color_way): {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/fetch-shoe-errors', methods=['GET'])
def fetch_shoe_errors():
    errors = []
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT shoe_error FROM shoe_sole_error_tbl WHERE shoe_error IS NOT NULL;")
        for row in cur.fetchall():
            if row[0]:
                errors.append(row[0].strip())
        cur.close()
        conn.close()
    except Exception as ex:
        print("DB error (fetch_shoe_errors):", ex)
        return jsonify({'error': str(ex)}), 500
    return jsonify({'shoe_errors': errors})

@app.route('/check-employee-no')
def check_employee_no():
    empno = request.args.get('empno', '').strip()
    if not empno:
        return jsonify({'allowed': False, 'reason': 'No empno provided'}), 400
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        # Kiểm tra user_id (empno hoặc username) và status = '1'
        cur.execute("""
            SELECT 1 FROM user_id_available_tbl
            WHERE user_id = %s AND status = '1'
            LIMIT 1
        """, (empno,))
        result = cur.fetchone()
        cur.close()
        conn.close()
        if result:
            return jsonify({'allowed': True})
        else:
            return jsonify({'allowed': False}), 200
    except Exception as ex:
        return jsonify({'allowed': False, 'error': str(ex)}), 500
@app.route('/proxy-getmold', methods=['POST'])
def proxy_getmold():
    try:
        # Nhận dữ liệu từ client
        raw_tooling_code = request.json.get('tooling_code', '')
        cleaned_code = raw_tooling_code.split('-')[0][:8]  # Cắt -1, lấy 8 ký tự đầu

        # Gửi GET request tới API thật
        response = requests.get("http://10.1.1.39/api/getmold", timeout=10)
        response.raise_for_status()
        json_data = response.json()

        # Lấy danh sách data từ response
        data_list = json_data.get("data", [])

        # Lọc ra danh sách article theo tooling_code bắt đầu bằng cleaned_code
        filtered_articles = [
            item['article'] for item in data_list
            if item.get('tooling_code', '').startswith(cleaned_code)
        ]
        return jsonify({'articles': filtered_articles})

    except Exception as e:
        return jsonify({'error': str(e)}), 500
# @app.route('/insert-ocr-error', methods=['POST'])
# def insert_ocr_error():
#     data = request.json
#     required_fields = [
#         'user_id', 'scan_time', 'mold_id', 'mold_name',
#         'mold_size', 'tool_code', 'production_shift', 'inkjet_time'
#     ]
#     missing_fields = [f for f in required_fields if f not in data or data[f] == '']
#     if missing_fields:
#         return jsonify({'error': f'Missing fields: {", ".join(missing_fields)}'}), 400

#     # ✅ Ép mold_size từ list 1 phần tử -> giá trị string
#     mold_size_val = data['mold_size']
#     if isinstance(mold_size_val, list):
#         if len(mold_size_val) == 1:
#             mold_size_val = mold_size_val[0]
#         else:
#             mold_size_val = ",".join(map(str, mold_size_val))  # nếu nhiều giá trị thì nối bằng dấu ,
    
#     try:
#         conn = psycopg2.connect(**DB_CONFIG)
#         cur = conn.cursor()
#         cur.execute("""
#             INSERT INTO error_ocr_tbl (
#                 user_id, scan_time, mold_id, mold_name,
#                 mold_size, tool_code, production_shift,
#                 inkjet_time, error_1, error_2, error_3
#             ) VALUES (
#                 %s, %s, %s, %s, %s,
#                 %s, %s,
#                 %s, %s, %s, %s
#             )
#         """, (
#             data['user_id'], data['scan_time'], data['mold_id'], data['mold_name'],
#             mold_size_val, data['tool_code'], data['production_shift'],
#             data['inkjet_time'], 
#             data.get('error_1'), data.get('error_2'), data.get('error_3')
#         ))
#         conn.commit()
#         cur.close()
#         conn.close()
#         return jsonify({'status': 'inserted'}), 200
#     except Exception as ex:
#         print(f"❌ DB error (insert_ocr_error): {ex}")
#         return jsonify({'error': str(ex)}), 500
@app.route('/insert-ocr-error', methods=['POST'])
def insert_ocr_error():
    data = request.json

    # các field bắt buộc (giữ nguyên)
    required_fields = [
        'user_id', 'scan_time', 'mold_id', 'mold_name',
        'mold_size', 'tool_code', 'production_shift', 'inkjet_time'
    ]
    missing = [f for f in required_fields if f not in data or data[f] in ('', None)]
    if missing:
        return jsonify({'error': f'Missing fields: {", ".join(missing)}'}), 400

    # Ép mold_size: list[1] -> string
    mold_size_val = data['mold_size']
    if isinstance(mold_size_val, list):
        mold_size_val = mold_size_val[0] if len(mold_size_val) == 1 else ",".join(map(str, mold_size_val))

    # Chuẩn hoá timestamp để khớp kiểu timestamp (không tz)
    def normalize_ts(s):
        if not isinstance(s, str):
            return s
        # "2025-08-20T15:40:14.602Z" -> "2025-08-20 15:40:14.602"
        s = s.replace('T', ' ')
        if s.endswith('Z'):
            s = s[:-1]
        return s

    scan_time     = normalize_ts(data['scan_time'])
    inkjet_time   = normalize_ts(data['inkjet_time'])

    # Validate/nhận thêm field mới (tùy chọn, KHÔNG bắt buộc)
    side_lr   = data.get('side_lr')      # 'L' hoặc 'R' (có thể None)
    color_way = data.get('color_way')    # VD: "HQ1940-603"

    # Chuẩn hoá side_lr
    if side_lr is not None:
        side_lr = str(side_lr).upper()
        if side_lr not in ('L', 'R'):
            return jsonify({'error': 'side_lr must be L or R'}), 400

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO error_ocr_tbl (
                user_id, scan_time, mold_id, mold_name,
                mold_size, tool_code, production_shift,
                inkjet_time, side_lr, color_way,
                error_1, error_2, error_3
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s
            )
            RETURNING id
        """, (
            data['user_id'], scan_time, data['mold_id'], data['mold_name'],
            mold_size_val, data['tool_code'], data['production_shift'],
            inkjet_time, side_lr, color_way,
            data.get('error_1'), data.get('error_2'), data.get('error_3')
        ))
        new_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'status': 'inserted', 'id': new_id}), 200

    except Exception as ex:
        print(f"❌ DB error (insert_ocr_error): {ex}")
        return jsonify({'error': str(ex)}), 500


@app.route('/rotate', methods=['POST'])
def rotate_image():
    """
    Rotate an image by given degrees and direction.

    Form-data:
      - image: file (bắt buộc)
      - degrees: float (bắt buộc)
      - direction: 'cw' | 'ccw' (mặc định: 'ccw')
      - format: 'png' | 'jpeg' (mặc định: 'png')
      - keep_size: 'true' | 'false' (mặc định: 'true')
          true  -> giữ nguyên kích thước canvas (expand=False) => không bị nhỏ dần (có thể cắt góc)
          false -> cho phép canvas nở ra để không cắt góc (expand=True) => UI dễ “nhỏ dần” nếu đang fit theo khung
    Trả về: ảnh đã xoay (mimetype theo format)
    """
    try:
        # ---- Lấy input ----
        if 'image' not in request.files:
            return jsonify({'error': 'No image uploaded'}), 400
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        deg_raw = request.form.get('degrees')
        if deg_raw is None:
            return jsonify({'error': 'Missing "degrees"'}), 400
        try:
            degrees = float(deg_raw)
        except ValueError:
            return jsonify({'error': 'Invalid "degrees" value'}), 400

        direction = (request.form.get('direction', 'ccw') or 'ccw').lower().strip()
        if direction not in ('cw', 'ccw'):
            return jsonify({'error': 'Invalid "direction". Use "cw" or "ccw".'}), 400

        out_format = (request.form.get('format', 'png') or 'png').lower()
        if out_format not in ('png', 'jpeg', 'jpg'):
            return jsonify({'error': 'Invalid "format". Use "png" or "jpeg".'}), 400
        if out_format == 'jpg':
            out_format = 'jpeg'

        keep_size = (request.form.get('keep_size', 'true') or 'true').lower().strip() in ('1','true','yes')

        # ---- Đọc ảnh & sửa EXIF ----
        img_bytes = file.read()
        pil_img = Image.open(io.BytesIO(img_bytes))
        pil_img = ImageOps.exif_transpose(pil_img)  # đưa về đúng orientation trước khi xoay

        # ---- Tính góc (Pillow rotate là CCW) ----
        angle = degrees if direction == 'ccw' else -degrees

        # ---- Xoay ----
        # keep_size=True -> expand=False để giữ nguyên kích thước canvas => không bị "bé dần" trong UI
        rotated = pil_img.rotate(
            angle,
            expand=not keep_size,              # keep_size True => expand False
            resample=Image.BICUBIC,
            fillcolor=None if out_format == 'png' else (255, 255, 255)  # PNG giữ trong suốt, JPEG nền trắng
        )

        # ---- Trả về ảnh ----
        buf = io.BytesIO()
        save_kwargs = {}
        if out_format == 'jpeg':
            if rotated.mode in ('RGBA', 'LA'):
                rotated = rotated.convert('RGB')  # JPEG không hỗ trợ alpha
            save_kwargs.update({'quality': 95, 'optimize': True})
            mime = 'image/jpeg'
        else:
            mime = 'image/png'

        rotated.save(buf, format=out_format.upper(), **save_kwargs)
        buf.seek(0)
        return send_file(buf, mimetype=mime)

    except Exception as e:
        return jsonify({'error': 'Rotate failed', 'details': str(e)}), 500
def order_points_clockwise(pts):
    pts = np.array(pts)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return [tuple(p) for p in [tl, tr, br, bl]]  # A=TL, B=TR, C=BR, D=BL

def find_tag_corners(img, canny1=160, canny2=255, min_w=200, min_h=150, blur_type="Gaussian", blur_ksize=11, bilat_d=9, bilat_sigmaColor=75, bilat_sigmaSpace=75, dilate_iter=2, erode_iter=1):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if blur_type != "None":
        k = max(1, blur_ksize)
        if k % 2 == 0: k += 1
        if blur_type == "Gaussian" and k > 1:
            gray = cv2.GaussianBlur(gray, (k,k), 0)
        elif blur_type == "Median" and k > 1:
            gray = cv2.medianBlur(gray, k)
        elif blur_type == "Bilateral":
            gray = cv2.bilateralFilter(gray, bilat_d, bilat_sigmaColor, bilat_sigmaSpace)
    edges = cv2.Canny(gray, canny1, canny2, apertureSize=3)
    if dilate_iter or erode_iter:
        kernel = np.ones((3,3), np.uint8)
        if dilate_iter:
            edges = cv2.dilate(edges, kernel, iterations=dilate_iter)
        if erode_iter:
            edges = cv2.erode(edges, kernel, iterations=erode_iter)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_area = 0
    for cnt in contours:
        if len(cnt) < 5:
            continue
        rect = cv2.minAreaRect(cnt)
        (_, _), (w, h), _ = rect
        w, h = max(w, h), min(w, h)
        if w < min_w or h < min_h:
            continue
        area = w * h
        if area > best_area:
            best_area = area
            box = cv2.boxPoints(rect)
            best = np.int32(box)
    corner_labels = None
    angle_deg = None
    if best is not None:
        ordered = order_points_clockwise(best)
        labels = ['A','B','C','D']
        (ax, ay), (bx, by) = ordered[0], ordered[1]
        angle_deg = math.degrees(math.atan2(by - ay, bx - ax))
        corner_labels = dict(zip(labels, ordered))
    return corner_labels, angle_deg

def warp_rectangle(img, corners_dict):
    if not corners_dict:
        return None
    A = np.float32(corners_dict['A'])
    B = np.float32(corners_dict['B'])
    C = np.float32(corners_dict['C'])
    D = np.float32(corners_dict['D'])
    w1 = np.linalg.norm(B - A)
    w2 = np.linalg.norm(C - D)
    h1 = np.linalg.norm(D - A)
    h2 = np.linalg.norm(C - B)
    width = int(round(max(w1, w2)))
    height = int(round(max(h1, h2)))
    if width <= 0 or height <= 0:
        return None
    src = np.array([A, B, C, D], dtype=np.float32)
    dst = np.array([[0,0],[width-1,0],[width-1,height-1],[0,height-1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(img, M, (width, height), flags=cv2.INTER_LINEAR)
    return warped

def apply_clahe(bgr, clip=2.0, grid=8):
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l,a,b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(grid,grid))
    l2 = clahe.apply(l)
    lab2 = cv2.merge([l2,a,b])
    return cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)
@app.route('/api/generate', methods=['POST'])
def proxy_generate():
    """
    Proxy tới Ollama: POST http://10.13.34.154:11434/api/generate
    """
    try:
        payload = request.get_json(silent=True) or {}
    except Exception as e:
        return jsonify({"error": "Invalid JSON body", "details": str(e)}), 400

    upstream_url = "http://10.13.34.154:11434/api/generate"

    try:
        # forward nguyên headers tối thiểu, không stream
        r = requests.post(
            upstream_url,
            json=payload,
            timeout=120  # tăng timeout cho ảnh base64 lớn
        )

        # --- LOG chẩn đoán ---
        print(f"[Ollama] status={r.status_code}")
        # In tối đa 1KB để không spam log
        preview = r.text[:1024] if r.text else ''
        print(f"[Ollama] body preview: {preview}")

        # Trả passthrough status và nội dung (nhưng luôn là JSON response cho frontend)
        # Ollama thường trả JSON; nếu không parse được thì trả thẳng text.
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            # không phải JSON => trả text
            return (r.text, r.status_code, {'Content-Type': r.headers.get('Content-Type', 'text/plain')})

    except requests.exceptions.ConnectionError as e:
        # Không kết nối được Ollama (dịch vụ chưa chạy / IP sai / firewall)
        print(f"[Ollama] ConnectionError: {e}")
        return jsonify({
            "error": "Upstream connection error",
            "hint": "Kiểm tra Ollama có chạy ở 10.13.33.50:11434 và firewall/router",
            "details": str(e)
        }), 502

    except requests.exceptions.Timeout as e:
        print(f"[Ollama] Timeout: {e}")
        return jsonify({
            "error": "Upstream timeout",
            "hint": "Tăng timeout hoặc giảm kích thước ảnh/payload",
            "details": str(e)
        }), 504

    except requests.RequestException as e:
        print(f"[Ollama] RequestException: {e}")
        return jsonify({
            "error": "Ollama proxy error",
            "details": str(e)
        }), 502

@app.route('/rotate2', methods=['POST'])
def rotate_api():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400
    file = request.files['image']
    in_bytes = file.read()
    npimg = np.frombuffer(in_bytes, np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    # áp dụng CLAHE trước khi detect
    img = apply_clahe(img)
    corners, angle_deg = find_tag_corners(img)
    if not corners:
        return jsonify({'error': 'No rectangle detected'}), 400
    warped = warp_rectangle(img, corners)
    if warped is None:
        return jsonify({'error': 'Warp failed'}), 500
    buf = io.BytesIO()
    Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)).save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype='image/png')
def ensure_presets_folder():
    preset_dir = "./presets"
    if not os.path.exists(preset_dir):
        os.makedirs(preset_dir)
    return preset_dir

def get_next_preset_index():
    preset_dir = ensure_presets_folder()
    existing_files = [f for f in os.listdir(preset_dir) if f.startswith("preset_") and f.endswith(".json")]
    if not existing_files:
        return 1
    indices = []
    for f in existing_files:
        try:
            index = int(f.replace("preset_", "").replace(".json", ""))
            indices.append(index)
        except ValueError:
            continue
    return max(indices) + 1 if indices else 1

def save_preset(params):
    preset_dir = ensure_presets_folder()
    index = get_next_preset_index()
    filename = f"preset_{index}.json"
    filepath = os.path.join(preset_dir, filename)
    with open(filepath, 'w') as f:
        json.dump(params, f, indent=2)
    return filename

def load_preset(filename):
    preset_dir = ensure_presets_folder()
    filepath = os.path.join(preset_dir, filename)
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def list_presets():
    preset_dir = ensure_presets_folder()
    preset_files = [f for f in os.listdir(preset_dir) if f.startswith("preset_") and f.endswith(".json")]
    preset_files.sort()
    return preset_files

# ---------------------------
# Utility / image functions
# ---------------------------
def load_image(uploaded_file):
    # uploaded_file: werkzeug FileStorage or file-like with read()
    bytes_arr = np.asarray(bytearray(uploaded_file.read()), dtype=np.uint8)
    img = cv2.imdecode(bytes_arr, cv2.IMREAD_COLOR)
    return img

def detect_dominant_color(img, k=5):
    data = img.reshape((-1, 3))
    data = np.float32(data)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(data, k, None, criteria, 10, cv2.KMEANS_PP_CENTERS)
    centers = np.uint8(centers)
    label_counts = Counter(labels.flatten())
    total_pixels = len(labels)
    dominant_label = label_counts.most_common(1)[0][0]
    dominant_color_bgr = centers[dominant_label]
    dominant_color_hex = "#{:02x}{:02x}{:02x}".format(dominant_color_bgr[2], dominant_color_bgr[1], dominant_color_bgr[0])
    color_percentages = []
    for i, center in enumerate(centers):
        percentage = (label_counts.get(i, 0) / total_pixels) * 100
        hex_color = "#{:02x}{:02x}{:02x}".format(center[2], center[1], center[0])
        color_percentages.append((hex_color, percentage))
    color_percentages.sort(key=lambda x: x[1], reverse=True)
    return dominant_color_bgr, dominant_color_hex, color_percentages

def adjust_contrast(img, contrast):
    img = img.astype(np.float32)
    img = (img - 127.5) * contrast + 127.5
    img = np.clip(img, 0, 255).astype(np.uint8)
    return img

def calculate_color_distance(color1_hex, color2_hex):
    def hex_to_rgb(hex_color):
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    r1, g1, b1 = hex_to_rgb(color1_hex)
    r2, g2, b2 = hex_to_rgb(color2_hex)
    distance = math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2)
    return distance

def find_closest_preset_by_color(current_color_hex, threshold=100):
    preset_files = list_presets()
    closest_preset = None
    min_distance = float('inf')
    for preset_file in preset_files:
        preset_data = load_preset(preset_file)
        if preset_data and 'dominant_color_hex' in preset_data:
            preset_color = preset_data['dominant_color_hex']
            distance = calculate_color_distance(current_color_hex, preset_color)
            if distance < min_distance and distance <= threshold:
                min_distance = distance
                closest_preset = preset_file
    if closest_preset:
        max_distance = math.sqrt(3 * 255**2)
        similarity_percentage = max(0, (1 - min_distance / max_distance) * 100)
        return (closest_preset, min_distance, similarity_percentage)
    else:
        return (None, None, 0)

# ---------------------------
# Angle detection and ROI rotation/split
# ---------------------------
def detect_text_angle(img, canny_low, canny_high, blur_ksize, use_mask=True,
                      h_min=15, h_max=40, s_min=80, s_max=255, v_min=120, v_max=255):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_yellow = np.array([h_min, s_min, v_min])
    upper_yellow = np.array([h_max, s_max, v_max])
    yellow_mask = cv2.inRange(hsv, lower_yellow, upper_yellow)
    gray_proc = cv2.bitwise_and(gray, gray, mask=yellow_mask) if use_mask else gray.copy()
    if blur_ksize > 0:
        gray_proc = cv2.GaussianBlur(gray_proc, (blur_ksize, blur_ksize), 0)
        gray = cv2.GaussianBlur(gray, (blur_ksize, blur_ksize), 0)
    edges_masked = cv2.Canny(gray_proc, canny_low, canny_high)
    contours, _ = cv2.findContours(edges_masked, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0, edges_masked, yellow_mask
    filtered = [cnt.squeeze() for cnt in contours if cnt.shape[0] > 2]
    if not filtered:
        return 0.0, edges_masked, yellow_mask
    all_pts = np.vstack(filtered)
    rect = cv2.minAreaRect(all_pts)
    angle = rect[2]
    w_rect, h_rect = rect[1]
    if w_rect < h_rect:
        angle = angle + 90
    angle = ((angle + 90) % 180) - 90
    if abs(angle) > 90:
        if angle > 0:
            angle = angle - 180
        else:
            angle = angle + 180
    return angle, edges_masked, yellow_mask

def rotate_and_split_abcd(orig_img, edge_mask, angle_deg):
    h, w = orig_img.shape[:2]
    PAD = 10
    def _replicate_pad(img, pad=PAD):
        if img is None or img.size == 0:
            return img
        return cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    contours, _ = cv2.findContours(edge_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    valid_cnts = [c for c in contours if c.shape[0] > 2]
    if not valid_cnts:
        aligned_crop = orig_img.copy()
        mid = h // 2
        top = aligned_crop[:mid, :]
        bot = aligned_crop[mid:, :]
        min_h = min(top.shape[0], bot.shape[0])
        top = top[:min_h, :]
        bot = bot[:min_h, :]
        combined = np.hstack((top, bot))
        return aligned_crop, _replicate_pad(combined)
    all_pts = np.vstack(valid_cnts)
    rect = cv2.minAreaRect(all_pts)
    (cx, cy), (w_rect, h_rect), rect_angle = rect
    M = cv2.getRotationMatrix2D((cx, cy), angle_deg, 1.0)
    rotated_full = cv2.warpAffine(orig_img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    tw = int(round(max(w_rect, h_rect)))
    th = int(round(min(w_rect, h_rect)))
    tw = max(1, tw)
    th = max(1, th)
    x1 = int(round(cx - tw / 2.0))
    y1 = int(round(cy - th / 2.0))
    x2 = x1 + tw
    y2 = y1 + th
    x1p = max(0, x1 - PAD)
    y1p = max(0, y1 - PAD)
    x2p = min(w, x2 + PAD)
    y2p = min(h, y2 + PAD)
    if x2p <= x1p or y2p <= y1p:
        aligned_crop = orig_img.copy()
        mid = h // 2
        top = aligned_crop[:mid, :]
        bot = aligned_crop[mid:, :]
        min_h = min(top.shape[0], bot.shape[0])
        top = top[:min_h, :]
        bot = bot[:min_h, :]
        combined = np.hstack((top, bot))
        return aligned_crop, _replicate_pad(combined)
    aligned_crop = rotated_full[y1p:y2p, x1p:x2p]
    if aligned_crop.size == 0:
        aligned_crop = orig_img.copy()
        mid = h // 2
        top = aligned_crop[:mid, :]
        bot = aligned_crop[mid:, :]
        min_h = min(top.shape[0], bot.shape[0])
        top = top[:min_h, :]
        bot = bot[:min_h, :]
        combined = np.hstack((top, bot))
        return aligned_crop, _replicate_pad(combined)
    ch = aligned_crop.shape[0]
    mid_h = ch // 2
    top_crop = aligned_crop[:mid_h, :]
    bottom_crop = aligned_crop[mid_h:, :]
    if top_crop.size == 0 or bottom_crop.size == 0:
        combined = np.hstack((aligned_crop, aligned_crop))
        return aligned_crop, _replicate_pad(combined)
    th_top = top_crop.shape[0]
    th_bot = bottom_crop.shape[0]
    min_hcrop = min(th_top, th_bot)
    top_crop = top_crop[:min_hcrop, :]
    bottom_crop = bottom_crop[:min_hcrop, :]
    tw_top = top_crop.shape[1]
    tw_bot = bottom_crop.shape[1]
    min_wcrop = min(tw_top, tw_bot)
    top_crop = top_crop[:, :min_wcrop]
    bottom_crop = bottom_crop[:, :min_wcrop]
    combined = np.hstack((top_crop, bottom_crop))
    return aligned_crop, combined

# ---------------------------
# Defaults used by API endpoints
# ---------------------------
DEFAULTS = {
    "canny_low": 50,
    "canny_high": 150,
    "blur_ksize": 3,
    "use_mask": True,
    "h_min": 15,
    "h_max": 40,
    "s_min": 80,
    "s_max": 255,
    "v_min": 120,
    "v_max": 255,
    "contrast": 1.0,
    "color_threshold": 80
}

# ---------------------------
# Endpoints
# ---------------------------
@app.route("/inkjet-rotate", methods=["POST"])
def inkjet_rotate():
    if 'image' not in request.files:
        return jsonify({"error": "no image file uploaded (use form-data 'image')"}), 400
    file = request.files['image']
    if file.filename == "":
        return jsonify({"error": "empty filename"}), 400
    try:
        # load image
        img = load_image(file)
        if img is None:
            return jsonify({"error": "failed to decode image"}), 400

        # 1) Detect dominant color for preset matching
        dominant_bgr, dominant_hex, _ = detect_dominant_color(img)

        # 2) Determine color threshold (allow override via form)
        color_threshold = float(request.form.get("color_threshold", DEFAULTS.get("color_threshold", 80)))

        # 3) Find closest preset by color
        closest_preset, distance, similarity = find_closest_preset_by_color(dominant_hex, color_threshold)
        preset_data = load_preset(closest_preset) if closest_preset else None

        # 4) Build processing params: start with DEFAULTS, then preset, then explicit form overrides
        params = DEFAULTS.copy()
        if preset_data:
            # Copy relevant keys from preset if present
            for key in ('use_mask', 'canny_low', 'canny_high', 'blur_ksize',
                        'h_min', 'h_max', 's_min', 's_max', 'v_min', 'v_max', 'contrast'):
                if key in preset_data:
                    params[key] = preset_data[key]

        # Apply explicit form overrides (highest precedence)
        for key in params.keys():
            if key in request.form:
                val = request.form[key]
                if isinstance(DEFAULTS.get(key), bool):
                    params[key] = val.lower() in ("1", "true", "yes", "on")
                elif isinstance(DEFAULTS.get(key), int):
                    try:
                        params[key] = int(val)
                    except ValueError:
                        params[key] = params[key]
                else:
                    try:
                        params[key] = float(val)
                    except ValueError:
                        params[key] = params[key]

        # 5) Apply contrast only for detection processing
        img_contrast = adjust_contrast(img, params.get("contrast", 1.0))

        # 6) Detect angle & edge mask using merged params
        angle, edge_mask, _ = detect_text_angle(
            img_contrast,
            params.get("canny_low"),
            params.get("canny_high"),
            params.get("blur_ksize"),
            params.get("use_mask"),
            params.get("h_min"),
            params.get("h_max"),
            params.get("s_min"),
            params.get("s_max"),
            params.get("v_min"),
            params.get("v_max"),
        )

        # 7) Rotate & split only the ABCD region and get combined result
        aligned_crop, combined = rotate_and_split_abcd(img, edge_mask, angle)
        if combined is None or combined.size == 0:
            return jsonify({"error": "processing returned empty image"}), 500

        # 8) Encode combined image to PNG in memory
        success, png = cv2.imencode(".png", combined)
        if not success:
            return jsonify({"error": "failed to encode result"}), 500

        # Optionally set header to indicate which preset was used
        headers = {}
        if closest_preset:
            headers['X-Used-Preset'] = closest_preset
            headers['X-Preset-Similarity'] = f"{similarity:.2f}"
            headers['X-Preset-Distance'] = f"{distance:.2f}"
        headers['X-Detected-Dominant-Color'] = dominant_hex

        resp = send_file(
            io.BytesIO(png.tobytes()),
            mimetype="image/png",
            as_attachment=False,
            download_name="combined_abcd.png"
        )
        # attach custom headers to the response
        for k, v in headers.items():
            resp.headers[k] = v
        return resp
    except Exception as e:
        return jsonify({"error": "internal error", "message": str(e)}), 500

@app.route("/inkjet-rotate/compare", methods=["POST"])
def inkjet_rotate_compare():
    """
    Returns JSON containing:
      - dominant_color_hex
      - dominant_color_bgr
      - closest_preset (filename or null)
      - distance
      - similarity_percentage
    """
    if 'image' not in request.files:
        return jsonify({"error": "no image file uploaded (use form-data 'image')"}), 400
    file = request.files['image']
    if file.filename == "":
        return jsonify({"error": "empty filename"}), 400
    try:
        img = load_image(file)
        if img is None:
            return jsonify({"error": "failed to decode image"}), 400
        # detect dominant color on original image
        dominant_bgr, dominant_hex, _ = detect_dominant_color(img)
        threshold = float(request.form.get("color_threshold", DEFAULTS["color_threshold"]))
        closest, distance, similarity = find_closest_preset_by_color(dominant_hex, threshold)
        return jsonify({
            "dominant_color_hex": dominant_hex,
            "dominant_color_bgr": dominant_bgr.tolist(),
            "closest_preset": closest,
            "distance": distance,
            "similarity_percentage": similarity
        }), 200
    except Exception as e:
        return jsonify({"error": "internal error", "message": str(e)}), 500

# if __name__ == '__main__':
#     # --- Chạy bằng socketio thay vì app.run ---
#     # delete_thread = threading.Thread(
#     #     target=auto_delete_old_images, 
#     #     args=(UPLOAD_FOLDER,), 
#     #     daemon=True
#     # )
#     # delete_thread.start()
#     socketio.run(app, host="0.0.0.0", port=5000, debug=True)
if __name__ == '__main__':
    app.run(host="10.13.32.51", port=8443, debug=True, ssl_context='adhoc')
@app.before_request
def log_request_info():
    print(f"Headers: {request.headers}")
    print(f"Form: {request.form}")
    print(f"Files: {request.files}")
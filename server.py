from flask import Flask, request, send_file, jsonify, render_template_string, send_from_directory
from flask_cors import CORS
from PIL import Image, ImageOps
import io
import os
import cv2
import numpy as np
from rembg import remove
import psycopg2
import math
import requests  # Đảm bảo đã import requests
from werkzeug.utils import secure_filename
from flask_socketio import SocketIO, emit
import time
import threading
app = Flask(__name__)
CORS(app)

# --- Khởi tạo SocketIO ---
socketio = SocketIO(app, cors_allowed_origins="*")

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
        file_bytes = bytes.fromhex(file_hex)
        img = Image.open(io.BytesIO(file_bytes))
        img = ImageOps.exif_transpose(img)

        if roi_data:
            x = int(round(roi_data['x'] / scale))
            y = int(round(roi_data['y'] / scale))
            w = int(round(roi_data['w'] / scale))
            h = int(round(roi_data['h'] / scale))
        else:
            roi = read_roi()
            x, y, w, h = int(roi['x']), int(roi['y']), int(roi['w']), int(roi['h'])

        x = max(0, min(x, img.width - 1))
        y = max(0, min(y, img.height - 1))
        w = max(1, min(w, img.width - x))
        h = max(1, min(h, img.height - y))

        cropped = img.crop((x, y, x + w, y + h))

        # 🔹 Giới hạn chiều cao tối đa 320px
        # max_h = 250
        # if cropped.height > max_h:
        #     cropped = cropped.crop((0, 0, cropped.width, max_h))

        # cropped_np = np.array(cropped)

        # if cropped_np.ndim == 3:
        #     gray = cv2.cvtColor(cropped_np, cv2.COLOR_RGB2GRAY)
        # else:
        #     gray = cropped_np
         # Convert PIL image to numpy array
        cropped_np = np.array(cropped)
        if cropped_np.ndim == 3:
            gray = cv2.cvtColor(cropped_np, cv2.COLOR_RGB2GRAY)
        else:
            gray = cropped_np
        # Sử dụng CLAHE để cải thiện độ tương phản
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        result_img = Image.fromarray(enhanced)
        buf = io.BytesIO()
        result_img.save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')

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
@app.route('/ocrOnly', methods=['POST'])
def ocr_only():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400
    
    file = request.files['image']
    image_bytes = file.read()

    # Gửi ảnh trực tiếp lên API OCR
    ocr_url = "http://10.13.33.50:5000/sole_inkjet_ocr"
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

    return jsonify({
        "text": ocr_text
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
connected_devices = {}

@socketio.on('connect')
def on_connect():
    print("Client connected:", request.sid)
    # Gửi danh sách device_id đang online cho client mới
    emit('device_connected', list(connected_devices.keys()))

@socketio.on('disconnect')
def on_disconnect():
    print("Client disconnected:", request.sid)
    for k, v in list(connected_devices.items()):
        if v == request.sid:
            del connected_devices[k]
    # Broadcast danh sách device_id mới cho tất cả client
    socketio.emit('device_connected', list(connected_devices.keys()))

@socketio.on('register_device')
def on_register_device(data):
    print("🧪 Kiểu dữ liệu nhận được từ client:", type(data))
    print("📥 Dữ liệu raw:", data)
    device_id = data.get("device_id")
    if device_id:
        connected_devices[device_id] = request.sid
        print(f"Device {device_id} registered with SID {request.sid}")
        # Broadcast danh sách device_id mới cho tất cả client
        socketio.emit('device_connected', list(connected_devices.keys()))

@socketio.on('capture_photo')
def on_capture_photo(data):
    device_id = data.get("device_id")
    sid = connected_devices.get(device_id)
    if sid:
        emit('trigger_capture', {}, to=sid)
        print(f"Sent trigger_capture to {device_id}")
    else:
        print(f"Device {device_id} not connected.")
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

        print(f"[DEBUG] Cleaned Code: {cleaned_code}")
        for item in data_list:
            print(f"[DEBUG] tooling_code='{item.get('tooling_code')}' | article='{item.get('article')}'")

        print(f"[DEBUG] Filtered articles: {filtered_articles}")
        return jsonify({'articles': filtered_articles})

    except Exception as e:
        return jsonify({'error': str(e)}), 500
@app.route('/insert-ocr-error', methods=['POST'])
def insert_ocr_error():
    data = request.json
    required_fields = [
        'user_id', 'scan_time', 'mold_id', 'mold_name',
        'mold_size', 'tool_code', 'production_shift', 'inkjet_time'
    ]
    missing_fields = [f for f in required_fields if f not in data or data[f] == '']
    if missing_fields:
        return jsonify({'error': f'Missing fields: {", ".join(missing_fields)}'}), 400

    # ✅ Ép mold_size từ list 1 phần tử -> giá trị string
    mold_size_val = data['mold_size']
    if isinstance(mold_size_val, list):
        if len(mold_size_val) == 1:
            mold_size_val = mold_size_val[0]
        else:
            mold_size_val = ",".join(map(str, mold_size_val))  # nếu nhiều giá trị thì nối bằng dấu ,
    
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO error_ocr_tbl (
                user_id, scan_time, mold_id, mold_name,
                mold_size, tool_code, production_shift,
                inkjet_time, error_1, error_2, error_3
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s
            )
        """, (
            data['user_id'], data['scan_time'], data['mold_id'], data['mold_name'],
            mold_size_val, data['tool_code'], data['production_shift'],
            data['inkjet_time'], 
            data.get('error_1'), data.get('error_2'), data.get('error_3')
        ))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'status': 'inserted'}), 200
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

if __name__ == '__main__':
    # --- Chạy bằng socketio thay vì app.run ---
    # delete_thread = threading.Thread(
    #     target=auto_delete_old_images, 
    #     args=(UPLOAD_FOLDER,), 
    #     daemon=True
    # )
    # delete_thread.start()
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
@app.before_request
def log_request_info():
    print(f"Headers: {request.headers}")
    print(f"Form: {request.form}")
    print(f"Files: {request.files}")
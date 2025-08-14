from flask import Flask, request, send_file, jsonify, render_template_string
from flask_cors import CORS
from PIL import Image, ImageOps
import io
import os
import cv2
import numpy as np
import psycopg2

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
ROI_CONFIG = 'roi-config.txt'
HTML_FILE = 'roi-cropper.html'

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
                    AND mold_ip IS NOT NULL
            """
            params = [mold_id, mold_id] + size + [shift, shift, shift]
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
                    AND mold_ip IS NOT NULL
            """
            params = [mold_id, mold_id, '', '', shift, shift, shift]
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

if __name__ == '__main__':
    app.run(debug=True)
    app.run(debug=True)

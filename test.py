import cv2
import numpy as np
from pathlib import Path
import sys
import os

# --------- Utils ---------
def list_images(folder: Path):
    exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
    files = [p for p in sorted(folder.iterdir()) if p.suffix.lower() in exts]
    return files

def ensure_odd(x: int) -> int:
    return x + 1 if x % 2 == 0 else x

def keep_yellow_hsv(img_bgr, loH, hiH, loS, hiS, loV, hiV,
                    ksize=3, it_open=1, it_close=1, sat_boost=0):
    """
    Lọc theo 1 dải HSV (có thể chọn 5..40 để phủ orange->yellow).
    sat_boost: 0..100 (0 = không boost, 100 = boost mạnh)
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # Tăng saturation nếu cần để tách màu rõ hơn
    if sat_boost > 0:
        h, s, v = cv2.split(hsv)
        s = cv2.normalize(s, None, 0, 255, cv2.NORM_MINMAX)
        # blend tuyến tính: s' = (1-a)*s + a*stretch(s)
        a = sat_boost / 100.0
        s = cv2.addWeighted(s, 1 + a, s, 0, 0)  # boost nhẹ
        s = np.clip(s, 0, 255).astype(np.uint8)
        hsv = cv2.merge([h, s, v])

    lower = np.array([loH, loS, loV], dtype=np.uint8)
    upper = np.array([hiH, hiS, hiV], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower, upper)

    # Morphology nhẹ để làm sạch nhưng vẫn giữ dạng chấm-bi
    if ksize < 1: ksize = 1
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ensure_odd(ksize), ensure_odd(ksize)))
    if it_open > 0:
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=it_open)
    if it_close > 0:
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=it_close)

    # Áp mask giữ lại vùng vàng
    result_bgr = cv2.bitwise_and(img_bgr, img_bgr, mask=mask)
    return mask, result_bgr

def visualize(mask, src, result):
    # Mask hiển thị dạng BGR (màu trắng = vùng vàng)
    mask_vis = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    # resize cho vừa xem nếu ảnh lớn
    max_h = 480
    scale = min(1.0, max_h / max(src.shape[0], 1))
    if scale < 1.0:
        new_size = (int(src.shape[1]*scale), int(src.shape[0]*scale))
        src = cv2.resize(src, new_size, interpolation=cv2.INTER_AREA)
        mask_vis = cv2.resize(mask_vis, new_size, interpolation=cv2.INTER_NEAREST)
        result = cv2.resize(result, new_size, interpolation=cv2.INTER_AREA)
    # ghép ngang
    grid = cv2.hconcat([src, mask_vis, result])
    return grid

def save_outputs(out_dir: Path, img_path: Path, mask, result):
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = img_path.stem
    cv2.imwrite(str(out_dir / f"{stem}_mask.png"), mask)
    cv2.imwrite(str(out_dir / f"{stem}_yellow.png"), result)
    # PNG RGBA nền trong suốt
    b,g,r = cv2.split(result)
    rgba = cv2.merge([b,g,r, mask])
    cv2.imwrite(str(out_dir / f"{stem}_yellow_rgba.png"), rgba)

# --------- Main GUI ---------
def main():
    img_dir = Path("yellow")
    files = list_images(img_dir)
    if not files:
        print("⚠️  Không tìm thấy ảnh trong thư mục 'yellow/'. Hãy bỏ ảnh vào đó rồi chạy lại.")
        sys.exit(1)

    # Tạo cửa sổ
    cv2.namedWindow("Yellow Filter GUI", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Yellow Filter GUI", 1400, 520)
    cv2.namedWindow("Controls", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Controls", 460, 520)

    # Trackbars cho HSV
    cv2.createTrackbar("loH", "Controls", 5,   179, lambda x: None)
    cv2.createTrackbar("hiH", "Controls", 40,  179, lambda x: None)
    cv2.createTrackbar("loS", "Controls", 30,  255, lambda x: None)
    cv2.createTrackbar("hiS", "Controls", 255, 255, lambda x: None)
    cv2.createTrackbar("loV", "Controls", 80,  255, lambda x: None)
    cv2.createTrackbar("hiV", "Controls", 255, 255, lambda x: None)

    # Morphology & boost
    cv2.createTrackbar("ksize",     "Controls", 3,   15,  lambda x: None)  # kernel size (odd)
    cv2.createTrackbar("open_iter", "Controls", 1,   5,   lambda x: None)
    cv2.createTrackbar("close_itr", "Controls", 1,   5,   lambda x: None)
    cv2.createTrackbar("sat_boost", "Controls", 0,   100, lambda x: None)  # 0..100

    # Slider chọn ảnh
    cv2.createTrackbar("image_idx", "Controls", 0, len(files)-1, lambda x: None)

    print(
        "Hướng dẫn:\n"
        " - Dùng sliders trong cửa sổ 'Controls' để chỉnh HSV, morphology, và chọn ảnh.\n"
        " - Phím 's' lưu kết quả (mask, ảnh chỉ-vàng, PNG RGBA) vào thư mục 'out/'.\n"
        " - Phím 'n' / 'p' chuyển ảnh kế / trước.\n"
        " - Phím 'q' để thoát."
    )

    idx = 0
    while True:
        # cập nhật index từ slider
        idx = cv2.getTrackbarPos("image_idx", "Controls")
        img_path = files[idx]
        img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
        if img is None:
            canvas = np.zeros((400, 1200, 3), dtype=np.uint8)
            cv2.putText(canvas, f"Cannot read {img_path}", (30, 200),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0,0,255), 2, cv2.LINE_AA)
            cv2.imshow("Yellow Filter GUI", canvas)
        else:
            loH = cv2.getTrackbarPos("loH", "Controls")
            hiH = cv2.getTrackbarPos("hiH", "Controls")
            loS = cv2.getTrackbarPos("loS", "Controls")
            hiS = cv2.getTrackbarPos("hiS", "Controls")
            loV = cv2.getTrackbarPos("loV", "Controls")
            hiV = cv2.getTrackbarPos("hiV", "Controls")
            ksize     = cv2.getTrackbarPos("ksize", "Controls")
            open_iter = cv2.getTrackbarPos("open_iter", "Controls")
            close_itr = cv2.getTrackbarPos("close_itr", "Controls")
            sat_boost = cv2.getTrackbarPos("sat_boost", "Controls")

            # đảm bảo phạm vi hợp lệ
            hiH = max(hiH, loH)
            hiS = max(hiS, loS)
            hiV = max(hiV, loV)

            mask, result = keep_yellow_hsv(
                img, loH, hiH, loS, hiS, loV, hiV,
                ksize=ksize, it_open=open_iter, it_close=close_itr, sat_boost=sat_boost
            )
            grid = visualize(mask, img, result)
            title = f"{img_path.name} | H[{loH},{hiH}] S[{loS},{hiS}] V[{loV},{hiV}] | k={ensure_odd(ksize)} open={open_iter} close={close_itr} sat+={sat_boost}"
            cv2.imshow("Yellow Filter GUI", grid)
            cv2.setWindowTitle("Yellow Filter GUI", title)

        key = cv2.waitKey(30) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('s'):
            save_outputs(Path("out"), img_path, mask, result)
            print(f"✅ Saved outputs for: {img_path.name} -> out/")
        elif key == ord('n'):
            idx = (idx + 1) % len(files)
            cv2.setTrackbarPos("image_idx", "Controls", idx)
        elif key == ord('p'):
            idx = (idx - 1) % len(files)
            cv2.setTrackbarPos("image_idx", "Controls", idx)

    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()

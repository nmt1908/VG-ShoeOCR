import cv2
import numpy as np

# Bước 1: Đọc ảnh và chuyển sang ảnh xám
img = cv2.imread('../crop_image/123.jpg')

# Giữ lại màu: chuyển sang không gian LAB để áp dụng CLAHE lên kênh L
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
l, a, b = cv2.split(lab)

clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
cl = clahe.apply(l)

# Gộp lại các kênh sau khi tăng tương phản
lab_clahe = cv2.merge((cl, a, b))
img_clahe = cv2.cvtColor(lab_clahe, cv2.COLOR_LAB2BGR)

# Áp dụng kernel làm sắc nét lên ảnh màu đã tăng tương phản
sharpen_kernel = np.array([[0, -1, 0],
                           [-1, 5,-1],
                           [0, -1, 0]])
sharpened = cv2.filter2D(img_clahe, -1, sharpen_kernel)

# Lưu ảnh kết quả
cv2.imwrite('clahe_sharpened_color.jpg', sharpened)
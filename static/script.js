const dropArea = document.getElementById('drop-area');
const fileElem = document.getElementById('fileElem');
const canvas = document.getElementById('roi-canvas');
const ctx = canvas.getContext('2d');
const recognizeBtn = document.getElementById('recognize-btn');
const resultDiv = document.getElementById('result');
const imgSizeDiv = document.getElementById('img-size');

let img = null;
let imgNaturalWidth = 0, imgNaturalHeight = 0;
let scale = 1;
let roi = { x: 100, y: 100, w: 200, h: 120 };
// Thay đổi: sideDetectRoi cho phép chỉnh sửa
let sideDetectRoi = { x: 200, y: 300, w: 200, h: 120 }; // mặc định, sẽ load từ file
let selectedRoi = 'roi'; // 'roi' hoặc 'side' -- xác định ROI nào đang được chỉnh sửa
let dragging = false, resizing = false, dragOffset = {}, resizeCorner = null;
let sCount = 0, eCount = 0;
let roiEditable = false;
const roiToast = document.getElementById('roi-toast');
let uploadedFilename = null;
let uploadedFileHex = null;

// --- Thêm biến lưu kết quả side ---
let lastSideResult = null;

// --- Thêm biến lưu yellow text ---
let lastYellowText = null;
let lastYellowImgUrl = null;
const autoRotateCheckbox = document.getElementById('auto-rotate-checkbox');

document.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
});
document.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
});
function sendCapture() {
    fetch('/trigger-capture?device_id=device_1')
        .then(res => res.text())
        .then(txt => document.getElementById("status").innerText = txt)
        .catch(err => console.error(err));
}
// --- Load sideDetectRoi từ side_detect_roi.txt nếu có, nếu không thì giữ mặc định ---
function parseSideDetectRoiTxt(txt) {
    const lines = txt.split('\n');
    let newRoi = {};
    lines.forEach(line => {
        let [k, v] = line.split('=');
        if (k && v) newRoi[k.trim()] = parseFloat(v.trim());
    });
    if (newRoi.x !== undefined && newRoi.y !== undefined && newRoi.w !== undefined && newRoi.h !== undefined) {
        sideDetectRoi = { x: newRoi.x, y: newRoi.y, w: newRoi.w, h: newRoi.h };
    }
}
function loadSideDetectRoiFromTxt(callback) {
    // Sửa đường dẫn fetch để luôn lấy từ root server
    fetch('/side_detect_roi.txt')
        .then(res => {
            if (!res.ok) {
                // Nếu không có file, giữ nguyên sideDetectRoi mặc định, chỉ callback
                if (callback) callback();
                return Promise.reject();
            }
            return res.text();
        })
        .then(txt => {
            parseSideDetectRoiTxt(txt);
            if (callback) callback();
        })
        .catch(() => {
            // Không làm gì thêm, chỉ callback nếu có
            if (callback) callback();
        });
}
// --- API lưu sideDetectRoi vào side_detect_roi.txt ---
function saveSideDetectRoiToTxt() {
    fetch('/save-side-detect-roi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sideDetectRoi)
    });
}
function saveSideDetectRoiToServer() {
    fetch('/side_detect_roi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sideDetectRoi)
    });
}
// Draw image and ROI
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // --- Vẽ ROI phụ (sideDetectRoi, màu cam) ---
        ctx.save();
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(sideDetectRoi.x, sideDetectRoi.y, sideDetectRoi.w, sideDetectRoi.h);
        ctx.setLineDash([]);
        // Draw resize handles cho sideDetectRoi nếu đang chỉnh sửa ROI này
        if (roiEditable && selectedRoi === 'side') {
            getHandles(sideDetectRoi).forEach(h => {
                ctx.fillStyle = '#fb923c';
                ctx.fillRect(h.x - 7, h.y - 7, 14, 14);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.strokeRect(h.x - 7, h.y - 7, 14, 14);
            });
        }
        ctx.restore();

        // --- Vẽ ROI chính (màu đỏ) ---
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8]);
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.setLineDash([]);
        // Draw resize handles cho roi nếu đang chỉnh sửa ROI này
        if (roiEditable && selectedRoi === 'roi') {
            getHandles(roi).forEach(h => {
                ctx.fillStyle = '#2563eb';
                ctx.fillRect(h.x - 7, h.y - 7, 14, 14);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.strokeRect(h.x - 7, h.y - 7, 14, 14);
            });
        }
        ctx.restore();
    }
}
// Get 4 corners for resizing
function getHandles(r) {
    return [
        { x: r.x, y: r.y }, // top-left
        { x: r.x + r.w, y: r.y }, // top-right
        { x: r.x, y: r.y + r.h }, // bottom-left
        { x: r.x + r.w, y: r.y + r.h } // bottom-right
    ];
}
// Check if point is in handle
function getHandleAt(x, y, r) {
    return getHandles(r).findIndex(h => Math.abs(h.x - x) < 14 && Math.abs(h.y - y) < 14);
}
// Drag and drop
// dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.style.background = '#e0e7ef'; });
// dropArea.addEventListener('dragleave', e => { e.preventDefault(); dropArea.style.background = ''; });
// dropArea.addEventListener('drop', e => {
//     e.preventDefault();
//     dropArea.style.background = '';
//     handleFiles(e.dataTransfer.files);
// });
// fileElem.addEventListener('change', e => handleFiles(e.target.files));
function parseRoiTxt(txt) {
    const lines = txt.split('\n');
    let newRoi = {};
    lines.forEach(line => {
        let [k, v] = line.split('=');
        if (k && v) newRoi[k.trim()] = parseFloat(v.trim());
    });
    if (newRoi.x !== undefined && newRoi.y !== undefined && newRoi.w !== undefined && newRoi.h !== undefined) {
        roi = { x: newRoi.x, y: newRoi.y, w: newRoi.w, h: newRoi.h };
    }
}
// Load ROI from roi-config.txt when loading new image
function loadRoiFromTxt(callback) {
    // Nếu chạy qua proxy/nginx hoặc Flask không phục vụ file này, fallback về fetch từ static
    fetch('/roi-config.txt')
        .then(res => {
            if (res.ok) return res.text();
            // Nếu 404, thử lại với đường dẫn static
            return fetch('/static/roi-config.txt').then(r2 => r2.ok ? r2.text() : Promise.reject());
        })
        .then(txt => {
            parseRoiTxt(txt);
            callback();
        })
        .catch(() => callback());
}
function loadRoiFromServer(callback) {
    fetch('/roi')
        .then(res => res.json())
        .then(roiData => {
            roi = roiData;
            callback();
        })
        .catch(() => callback());
}
function handleFiles(files) {
    if (!files.length) return;
    const file = files[0];
    const formData = new FormData();
    formData.append('image', file);
    fetch('/upload', { method: 'POST', body: formData })
        .then(res => {
            if (!res.ok) {
                resultDiv.innerHTML = '<span style="color:#ef4444;font-size:16px;">Image upload failed or server is not running!</span>';
                throw new Error('Upload failed');
            }
            return res.json();
        })
        .then(data => {
            if (!data.filename || !data.filedata) {
                resultDiv.innerHTML = '<span style="color:#ef4444;font-size:16px;">No file data received from server!</span>';
                return;
            }
            uploadedFilename = data.filename;
            uploadedFileHex = data.filedata;
            img = new Image();
            img.onload = function () {
                imgNaturalWidth = img.naturalWidth;
                imgNaturalHeight = img.naturalHeight;
                imgSizeDiv.textContent = `Kích thước ảnh gốc: ${imgNaturalWidth} × ${imgNaturalHeight} pixels`;
                let maxW = 600, maxH = 800;
                scale = Math.min(maxW / imgNaturalWidth, maxH / imgNaturalHeight, 1);
                canvas.width = Math.round(imgNaturalWidth * scale);
                canvas.height = Math.round(imgNaturalHeight * scale);

                // --- Không gọi embossed_detect ở đây nữa ---
                // --- Chỉ load ROI từ file txt ---
                loadRoiFromServer(() => {
                    loadSideDetectRoiFromTxt(draw);
                });
                draw();
                // Không tự động chụp ảnh nữa
            };
            img.src = URL.createObjectURL(file);
        })
        .catch(err => {
            // Error already handled above, do not reload page
        });
}

// --- Hàm gọi embossed_detect khi chọn nút màu ---
async function runEmbossedDetectWithColor(colorDesc) {
    if (!img || !uploadedFilename || !uploadedFileHex) return;
    if (!colorDesc) return;
    // Gửi ảnh lên DINO API để lấy box theo colorDesc
    const dinoForm = new FormData();
    let blob = null;
    if (img.src.startsWith('blob:')) {
        blob = await fetch(img.src).then(r => r.blob());
    }
    if (!blob) return;
    // Đúng yêu cầu: keyword = "small mold number. " + description
    dinoForm.append('image', blob);
    dinoForm.append('keywords', 'small mold number. ' + colorDesc);
    dinoForm.append('box_threshold', 0.3);
    dinoForm.append('text_threshold', 0.3);

    // Gọi API
    const dinoRes = await fetch('https://10.13.32.51:8000/embossed_detect', {
        method: 'POST',
        body: dinoForm
    });
    const dinoData = await dinoRes.json();
    dinoDataCache = dinoData; // Lưu cache nếu cần dùng lại

    // --- Phần dưới giữ nguyên logic nhận diện box, vẽ ROI, crop, OCR ---
    if (dinoData && Array.isArray(dinoData.detections) && dinoData.detections.length > 0) {
        // --- Chọn box đầu tiên có height <= 400px ---
        let mainBox = null;
        for (const det of dinoData.detections) {
            const box = det.box;
            const height = box[3] - box[1];
            if (height <= 900) {
                mainBox = det;
                break;
            }
        }
        if (!mainBox) mainBox = dinoData.detections[0];
        const box = mainBox.box;
        // let xmin = Math.max(0, box[0] - 10);
        // let ymin = Math.max(0, box[1] - 30);
        // let xmax = Math.min(imgNaturalWidth, box[2] + 10);
        // let ymax = Math.min(imgNaturalHeight, box[3] + 30 + 150);

        // const x = xmin * scale;
        // const y = ymin * scale;
        // const w = (xmax - xmin) * scale;
        // const h = (ymax - ymin) * scale;
        // roi = { x, y, w, h };
        let xmin = Math.max(0, box[0]);
        let ymin = Math.max(0, box[1]);
        let xmax = Math.min(imgNaturalWidth, box[2]);
        let ymax = Math.min(imgNaturalHeight, box[3]);

        const x = xmin * scale;
        const y = ymin * scale;
        const w = (xmax - xmin) * scale;
        const h = (ymax - ymin) * scale;
        roi = { x, y, w, h };

        // --- Tìm box theo colorDesc ---
        const colorDescLower = colorDesc.toLowerCase();
        const colorBoxes = dinoData.detections.filter(det => det.label && det.label.toLowerCase().includes(colorDescLower));
        let colorBoxObj = null;
        if (colorBoxes.length > 0) {
            colorBoxObj = colorBoxes.reduce((minBox, currBox) => {
                const [xmin, ymin, xmax, ymax] = currBox.box;
                const area = (xmax - xmin) * (ymax - ymin);
                if (!minBox) return currBox;
                const [minXmin, minYmin, minXmax, minYmax] = minBox.box;
                const minArea = (minXmax - minXmin) * (minYmax - minYmin);
                return area < minArea ? currBox : minBox;
            }, null);
        }
        // if (colorBoxObj) {
        //     // Lấy box và mở rộng 5px mỗi cạnh trên ảnh gốc
        //     // let box = colorBoxObj.box;
        //     // let xmin = Math.max(0, box[0] - 5);
        //     // let ymin = Math.max(0, box[1] - 5);
        //     // let xmax = Math.min(imgNaturalWidth, box[2] + 5);
        //     // let ymax = Math.min(imgNaturalHeight, box[3] + 5);
        //     let box = colorBoxObj.box;
        //     let xmin = Math.max(0, box[0]);
        //     let ymin = Math.max(0, box[1]);
        //     let xmax = Math.min(imgNaturalWidth, box[2]);
        //     let ymax = Math.min(imgNaturalHeight, box[3]);

        //     // --- XÓA THÔNG BÁO "No yellow text" NẾU CÓ ---
        //     let msg = document.getElementById('no-yellow-text-msg');
        //     if (msg && msg.parentNode) {
        //         msg.parentNode.removeChild(msg);
        //     }
        //     // Crop từ ảnh gốc (img)
        //     const cropW = Math.round(xmax - xmin);
        //     const cropH = Math.round(ymax - ymin);
        //     const tempCanvas = document.createElement('canvas');
        //     tempCanvas.width = cropW;
        //     tempCanvas.height = cropH;
        //     const tempCtx = tempCanvas.getContext('2d');
        //     tempCtx.drawImage(
        //         img,
        //         xmin, ymin, cropW, cropH,
        //         0, 0, cropW, cropH
        //     );
        //     // Cắt đôi theo chiều dọc (height)
        //     const halfH = Math.floor(cropH / 2);
        //     const topCanvas = document.createElement('canvas');
        //     topCanvas.width = cropW;
        //     topCanvas.height = halfH;
        //     const topCtx = topCanvas.getContext('2d');
        //     topCtx.drawImage(tempCanvas, 0, 0, cropW, halfH, 0, 0, cropW, halfH);
        //     const bottomCanvas = document.createElement('canvas');
        //     bottomCanvas.width = cropW;
        //     bottomCanvas.height = cropH - halfH;
        //     const bottomCtx = bottomCanvas.getContext('2d');
        //     bottomCtx.drawImage(tempCanvas, 0, halfH, cropW, cropH - halfH, 0, 0, cropW, cropH - halfH);
        //     const joinCanvas = document.createElement('canvas');
        //     joinCanvas.width = cropW * 2;
        //     joinCanvas.height = halfH;
        //     const joinCtx = joinCanvas.getContext('2d');
        //     joinCtx.drawImage(topCanvas, 0, 0);
        //     joinCtx.drawImage(bottomCanvas, cropW, 0, cropW, halfH);

        //     joinCanvas.toBlob(blob => {
        //         let orangeImg = document.getElementById('orange-text-crop-img');
        //         if (!orangeImg) {
        //             orangeImg = document.createElement('img');
        //             orangeImg.id = 'orange-text-crop-img';
        //             orangeImg.style.maxWidth = '98%';
        //             orangeImg.style.maxHeight = '180px';
        //             orangeImg.style.width = 'auto';
        //             orangeImg.style.height = 'auto';
        //             orangeImg.style.borderRadius = '10px';
        //             orangeImg.style.marginTop = '10px';
        //             orangeImg.style.boxShadow = '0 2px 12px rgba(251,146,60,0.13)';
        //             if (resultDiv.nextSibling) {
        //                 resultDiv.parentNode.insertBefore(orangeImg, resultDiv.nextSibling);
        //             } else {
        //                 resultDiv.parentNode.appendChild(orangeImg);
        //             }
        //         }
        //         orangeImg.src = URL.createObjectURL(blob);
        //         // --- Gửi ảnh mới này lên API /ocrOnly ---
        //         const formData = new FormData();
        //         formData.append('image', blob, 'orange_text.png');
        //         fetch('https://10.13.32.51:8443/ocrOnly', {
        //             method: 'POST',
        //             body: formData
        //         })
        //             .then(res => res.json())
        //             .then(data => {
        //                 // 1) Lấy text thô từ API
        //                 const raw = (data && typeof data.text === 'string') ? data.text.trim() : '';
        //                 // console.log('[OCR] raw:', raw); // ví dụ: "C0607003150"

        //                 // 2) Lấy 10 ký tự cuối
        //                 let t10 = raw.length > 10 ? raw.slice(-10) : raw;
        //                 // console.log('[OCR] last10:', t10); // "0607003150"

        //                 // 3) Map ký tự dễ nhầm -> số (chỉ áp dụng cho ký tự KHÔNG phải số)
        //                 const charMap = {
        //                     'O': '0', 'o': '0', 'Q': '0', 'D': '0', 'U': '0',
        //                     'I': '1', 'l': '1', 'L': '1', '|': '1', '!': '1', '/': '1', '\\': '1', ')': '1', '(': '1',
        //                     'Z': '2', 'z': '2',
        //                     'E': '3',
        //                     'A': '4',
        //                     'S': '5', 's': '5',
        //                     'b': '6', 'G': '6',
        //                     'T': '7', '?': '7',
        //                     'B': '8',
        //                     'g': '9', 'q': '9'
        //                 };
        //                 const mapped = t10.replace(/[^0-9]/g, ch => (charMap[ch] !== undefined ? charMap[ch] : ''));
        //                 // console.log('[OCR] mapped:', mapped); // vẫn "0607003150" vì đã là số

        //                 // 4) Nếu đủ 10 số thì format: "YY-MM HH:MM:SS"
        //                 let result = mapped;
        //                 if (/^\d{10}$/.test(mapped)) {
        //                     result = `${mapped.slice(0, 2)}-${mapped.slice(2, 4)} ${mapped.slice(4, 6)}:${mapped.slice(6, 8)}:${mapped.slice(8, 10)}`;
        //                 }
        //                 // console.log('[OCR] formatted:', result); // "06-07 00:31:50"

        //                 // 5) Lưu lại để dùng
        //                 lastYellowText = result;
        //             })

        //             .catch(() => {
        //                 lastYellowText = null;
        //             });
        //     }, 'image/png');
        // } else {
        if (colorBoxObj) {
            // --- Lấy box (không mở rộng) trên ảnh gốc ---
            const box = colorBoxObj.box;
            const xmin = Math.max(0, box[0]);
            const ymin = Math.max(0, box[1]);
            const xmax = Math.min(imgNaturalWidth, box[2]);
            const ymax = Math.min(imgNaturalHeight, box[3]);

            // --- XÓA THÔNG BÁO "No yellow text" NẾU CÓ ---
            const msg = document.getElementById('no-yellow-text-msg');
            if (msg && msg.parentNode) msg.parentNode.removeChild(msg);

            // --- Crop từ ảnh gốc (img) ---
            const cropW = Math.max(1, Math.round(xmax - xmin));
            const cropH = Math.max(1, Math.round(ymax - ymin));
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = cropW;
            cropCanvas.height = cropH;
            const cropCtx = cropCanvas.getContext('2d');

            cropCtx.drawImage(
                img,
                xmin, ymin, cropW, cropH,   // nguồn
                0, 0, cropW, cropH          // đích
            );

            // --- Không cắt đôi nữa. Gửi BẢN CROP GỐC lên /ocrOnly ---
            // cropCanvas.toBlob(async (blob) => {
            //     if (!blob) { lastYellowText = null; return; }

            //     // Hiển thị ảnh crop (tùy chọn)
            //     let orangeImg = document.getElementById('orange-text-crop-img');
            //     if (!orangeImg) {
            //         orangeImg = document.createElement('img');
            //         orangeImg.id = 'orange-text-crop-img';
            //         orangeImg.style.maxWidth = '98%';
            //         orangeImg.style.maxHeight = '180px';
            //         orangeImg.style.width = 'auto';
            //         orangeImg.style.height = 'auto';
            //         orangeImg.style.borderRadius = '10px';
            //         orangeImg.style.marginTop = '10px';
            //         orangeImg.style.boxShadow = '0 2px 12px rgba(251,146,60,0.13)';
            //         if (resultDiv.nextSibling) {
            //             resultDiv.parentNode.insertBefore(orangeImg, resultDiv.nextSibling);
            //         } else {
            //             resultDiv.parentNode.appendChild(orangeImg);
            //         }
            //     }
            //     const url = URL.createObjectURL(blob);
            //     orangeImg.onload = () => URL.revokeObjectURL(url);
            //     orangeImg.src = url;

            //     // --- Gửi ảnh crop gốc lên API /ocrOnly ---
            //     const formData = new FormData();
            //     formData.append('image', blob, 'orange_text.png');

            //     try {
            //         const res = await fetch('https://10.13.32.51:8443/ocrOnly', {
            //             method: 'POST',
            //             body: formData
            //         });
            //         const data = await res.json();

            //         // Xử lý text trả về
            //         let t = (data && typeof data.text === 'string') ? data.text.trim() : '';

            //         // Lấy 10 ký tự cuối
            //         if (t.length > 10) t = t.slice(-10);

            //         // Map ký tự dễ nhầm -> số
            //         const charMap = {
            //             'O': '0', 'o': '0', 'Q': '0', 'D': '0', 'U': '0',
            //             'I': '1', 'l': '1', 'L': '1', '|': '1', '!': '1', '/': '1', '\\': '1', ')': '1', '(': '1',
            //             'Z': '2', 'z': '2',
            //             'E': '3',
            //             'A': '4',
            //             'S': '5', 's': '5',
            //             'b': '6', 'G': '6',
            //             'T': '7', '?': '7',
            //             'B': '8',
            //             'g': '9', 'q': '9'
            //         };

            //         t = t.replace(/[^0-9]/g, ch => (charMap[ch] !== undefined ? charMap[ch] : ''));

            //         // Format nếu đủ 10 số
            //         if (t.length === 10) {
            //             t = `${t.slice(0, 2)}-${t.slice(2, 4)} ${t.slice(4, 6)}:${t.slice(6, 8)}:${t.slice(8, 10)}`;
            //         }

            //         lastYellowText = t;
            //     } catch (e) {
            //         lastYellowText = null;
            //     }
            // }, 'image/png');
            cropCanvas.toBlob(async (blob) => {
                if (!blob) { lastYellowText = null; return; }

                // (1) Gửi CROP sang /inkjet-rotate -> nhận ảnh PNG đã xử lý
                let rotatedBlob = null;
                try {
                    const fd = new FormData();
                    fd.append('image', blob, 'crop.png');

                    // muốn override tham số thì thêm ở đây:
                    // fd.append('color_threshold', '80');
                    // fd.append('contrast', '1.1');
                    // fd.append('canny_low', '50');
                    // fd.append('canny_high', '150');

                    const r = await fetch('https://10.13.32.51:8443/inkjet-rotate', {
                        method: 'POST',
                        body: fd
                    });

                    if (!r.ok) throw new Error('inkjet-rotate failed');
                    rotatedBlob = await r.blob();

                    // (2) CHỈ hiển thị ảnh từ /inkjet-rotate
                    let rotatedImg = document.getElementById('inkjet-rotate-preview');
                    if (!rotatedImg) {
                        rotatedImg = document.createElement('img');
                        rotatedImg.id = 'inkjet-rotate-preview';
                        rotatedImg.style.maxWidth = '98%';
                        rotatedImg.style.maxHeight = '180px';
                        rotatedImg.style.width = 'auto';
                        rotatedImg.style.height = 'auto';
                        rotatedImg.style.borderRadius = '10px';
                        rotatedImg.style.marginTop = '10px';
                        rotatedImg.style.boxShadow = '0 2px 12px rgba(59,130,246,0.13)';
                        if (resultDiv.nextSibling) {
                            resultDiv.parentNode.insertBefore(rotatedImg, resultDiv.nextSibling);
                        } else {
                            resultDiv.parentNode.appendChild(rotatedImg);
                        }
                    }
                    const rotUrl = URL.createObjectURL(rotatedBlob);
                    rotatedImg.onload = () => URL.revokeObjectURL(rotUrl);
                    rotatedImg.src = rotUrl;

                } catch (e) {
                    // nếu lỗi, bỏ hiển thị và tiếp tục OCR bằng blob gốc
                    rotatedBlob = blob;
                }

                // (3) Tiếp tục flow cũ: gửi ảnh (đã xử lý nếu ok) sang /ocrOnly
                try {
                    const formData = new FormData();
                    formData.append('image', rotatedBlob, 'inkjet.png');

                    const res = await fetch('https://10.13.32.51:8443/ocrOnly', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();

                    // xử lý text: lấy 10 ký tự cuối, map ký tự dễ nhầm, rồi format
                    let t = (data && typeof data.text === 'string') ? data.text.trim() : '';
                    if (t.length > 10) t = t.slice(-10);

                    const charMap = {
                        'O': '0', 'o': '0', 'Q': '0', 'D': '0', 'U': '0',
                        'I': '1', 'l': '1', 'L': '1', '|': '1', '!': '1', '/': '1', '\\': '1', ')': '1', '(': '1',
                        'Z': '2', 'z': '2', 'E': '3', 'A': '4',
                        'S': '5', 's': '5', 'b': '6', 'G': '6',
                        'T': '7', '?': '7', 'B': '8', 'g': '9', 'q': '9'
                    };
                    t = t.replace(/[^0-9]/g, ch => (charMap[ch] !== undefined ? charMap[ch] : ''));

                    if (t.length === 10) {
                        t = `${t.slice(0, 2)}-${t.slice(2, 4)} ${t.slice(4, 6)}:${t.slice(6, 8)}:${t.slice(8, 10)}`;
                    }
                    lastYellowText = t;
                } catch {
                    lastYellowText = null;
                }
            }, 'image/png');


        } else {

            // Không có box màu này, xóa ảnh cũ và hiển thị thông báo đỏ
            let orangeImg = document.getElementById('orange-text-crop-img');
            if (orangeImg && orangeImg.parentNode) {
                orangeImg.parentNode.removeChild(orangeImg);
            }
            let msg = document.getElementById('no-yellow-text-msg');
            if (!msg) {
                msg = document.createElement('div');
                msg.id = 'no-yellow-text-msg';
                msg.style.color = '#ef4444';
                msg.style.fontWeight = 'bold';
                msg.style.fontSize = '23px';
                msg.style.marginTop = '20px';
                msg.style.marginBottom = '10px';
                if (resultDiv.nextSibling) {
                    resultDiv.parentNode.insertBefore(msg, resultDiv.nextSibling);
                } else {
                    resultDiv.parentNode.appendChild(msg);
                }
            }
            msg.textContent = `No "${colorDesc}" text in this image`;
            lastYellowText = null;
        }
        // if (colorBoxObj) {
        //     let box = colorBoxObj.box;
        //     let xmin = Math.max(0, box[0]);
        //     let ymin = Math.max(0, box[1]);
        //     let xmax = Math.min(imgNaturalWidth, box[2]);
        //     let ymax = Math.min(imgNaturalHeight, box[3]);

        //     // Xóa thông báo nếu có
        //     let msg = document.getElementById('no-yellow-text-msg');
        //     if (msg && msg.parentNode) {
        //         msg.parentNode.removeChild(msg);
        //     }

        //     // Crop từ ảnh gốc
        //     const cropW = Math.round(xmax - xmin);
        //     const cropH = Math.round(ymax - ymin);
        //     const tempCanvas = document.createElement('canvas');
        //     tempCanvas.width = cropW;
        //     tempCanvas.height = cropH;
        //     const tempCtx = tempCanvas.getContext('2d');
        //     tempCtx.drawImage(img, xmin, ymin, cropW, cropH, 0, 0, cropW, cropH);

        //     // Hiển thị ảnh crop
        //     tempCanvas.toBlob(blob => {
        //         let orangeImg = document.getElementById('orange-text-crop-img');
        //         if (!orangeImg) {
        //             orangeImg = document.createElement('img');
        //             orangeImg.id = 'orange-text-crop-img';
        //             orangeImg.style.maxWidth = '98%';
        //             orangeImg.style.maxHeight = '180px';
        //             orangeImg.style.width = 'auto';
        //             orangeImg.style.height = 'auto';
        //             orangeImg.style.borderRadius = '10px';
        //             orangeImg.style.marginTop = '10px';
        //             orangeImg.style.boxShadow = '0 2px 12px rgba(251,146,60,0.13)';
        //             if (resultDiv.nextSibling) {
        //                 resultDiv.parentNode.insertBefore(orangeImg, resultDiv.nextSibling);
        //             } else {
        //                 resultDiv.parentNode.appendChild(orangeImg);
        //             }
        //         }
        //         orangeImg.src = URL.createObjectURL(blob);
        //     }, 'image/png');

        // } else {
        //     // Không có box -> xóa ảnh cũ + hiện thông báo
        //     let orangeImg = document.getElementById('orange-text-crop-img');
        //     if (orangeImg && orangeImg.parentNode) {
        //         orangeImg.parentNode.removeChild(orangeImg);
        //     }
        //     let msg = document.getElementById('no-yellow-text-msg');
        //     if (!msg) {
        //         msg = document.createElement('div');
        //         msg.id = 'no-yellow-text-msg';
        //         msg.style.color = '#ef4444';
        //         msg.style.fontWeight = 'bold';
        //         msg.style.fontSize = '23px';
        //         msg.style.marginTop = '20px';
        //         msg.style.marginBottom = '10px';
        //         if (resultDiv.nextSibling) {
        //             resultDiv.parentNode.insertBefore(msg, resultDiv.nextSibling);
        //         } else {
        //             resultDiv.parentNode.appendChild(msg);
        //         }
        //     }
        //     msg.textContent = `No "${colorDesc}" text in this image`;
        // }

        // Vẽ lại canvas với ROI mới
        draw();
        setTimeout(() => {
            recognizeBtn.click();
        }, 200);
    } else {
        // Không có box, fallback lấy từ file txt
        loadRoiFromServer(() => {
            loadSideDetectRoiFromTxt(draw);
        });
        draw();
        setTimeout(() => {
            recognizeBtn.click();
        }, 200);
    }
}

// --- Mouse events cho từng ROI, chỉ đăng ký một lần duy nhất ---
let draggingMain = false, resizingMain = false, dragOffsetMain = {}, resizeCornerMain = null;
let draggingSide = false, resizingSide = false, dragOffsetSide = {}, resizeCornerSide = null;
canvas.addEventListener('mousedown', e => {
    if (!img || !roiEditable) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    let roiIdx = getHandleAt(x, y, roi);
    let sideIdx = getHandleAt(x, y, sideDetectRoi);
    if (roiIdx !== -1 && sideIdx === -1) {
        selectedRoi = 'roi';
        resizingMain = true;
        resizeCornerMain = roiIdx;
    } else if (sideIdx !== -1 && roiIdx === -1) {
        selectedRoi = 'side';
        resizingSide = true;
        resizeCornerSide = sideIdx;
    } else if (x > roi.x && x < roi.x + roi.w && y > roi.y && y < roi.y + roi.h) {
        selectedRoi = 'roi';
        draggingMain = true;
        dragOffsetMain = { x: x - roi.x, y: y - roi.y };
    } else if (x > sideDetectRoi.x && x < sideDetectRoi.x + sideDetectRoi.w && y > sideDetectRoi.y && y < sideDetectRoi.y + sideDetectRoi.h) {
        selectedRoi = 'side';
        draggingSide = true;
        dragOffsetSide = { x: x - sideDetectRoi.x, y: y - sideDetectRoi.y };
    }
});
canvas.addEventListener('mousemove', e => {
    if (!img || !roiEditable) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Main ROI
    if (resizingMain) {
        switch (resizeCornerMain) {
            case 0: roi.w += roi.x - x; roi.h += roi.y - y; roi.x = x; roi.y = y; break;
            case 1: roi.w = x - roi.x; roi.h += roi.y - y; roi.y = y; break;
            case 2: roi.w += roi.x - x; roi.x = x; roi.h = y - roi.y; break;
            case 3: roi.w = x - roi.x; roi.h = y - roi.y; break;
        }
        roi.w = Math.max(30, Math.min(roi.w, canvas.width - roi.x));
        roi.h = Math.max(30, Math.min(roi.h, canvas.height - roi.y));
        roi.x = Math.max(0, Math.min(roi.x, canvas.width - 30));
        roi.y = Math.max(0, Math.min(roi.y, canvas.height - 30));
        draw();
    } else if (draggingMain) {
        roi.x = Math.max(0, Math.min(x - dragOffsetMain.x, canvas.width - roi.w));
        roi.y = Math.max(0, Math.min(y - dragOffsetMain.y, canvas.height - roi.h));
        draw();
    }

    // Side ROI
    if (resizingSide) {
        switch (resizeCornerSide) {
            case 0: sideDetectRoi.w += sideDetectRoi.x - x; sideDetectRoi.h += sideDetectRoi.y - y; sideDetectRoi.x = x; sideDetectRoi.y = y; break;
            case 1: sideDetectRoi.w = x - sideDetectRoi.x; sideDetectRoi.h += sideDetectRoi.y - y; sideDetectRoi.y = y; break;
            case 2: sideDetectRoi.w += sideDetectRoi.x - x; sideDetectRoi.x = x; sideDetectRoi.h = y - sideDetectRoi.y; break;
            case 3: sideDetectRoi.w = x - sideDetectRoi.x; sideDetectRoi.h = y - sideDetectRoi.y; break;
        }
        sideDetectRoi.w = Math.max(30, Math.min(sideDetectRoi.w, canvas.width - sideDetectRoi.x));
        sideDetectRoi.h = Math.max(30, Math.min(sideDetectRoi.h, canvas.height - sideDetectRoi.y));
        sideDetectRoi.x = Math.max(0, Math.min(sideDetectRoi.x, canvas.width - 30));
        sideDetectRoi.y = Math.max(0, Math.min(sideDetectRoi.y, canvas.height - 30));
        draw();
    } else if (draggingSide) {
        sideDetectRoi.x = Math.max(0, Math.min(x - dragOffsetSide.x, canvas.width - sideDetectRoi.w));
        sideDetectRoi.y = Math.max(0, Math.min(y - dragOffsetSide.y, canvas.height - sideDetectRoi.h));
        draw();
    }
});
canvas.addEventListener('mouseup', e => {
    draggingMain = false;
    resizingMain = false;
    resizeCornerMain = null;
    draggingSide = false;
    resizingSide = false;
    resizeCornerSide = null;
});
canvas.addEventListener('mouseleave', e => {
    draggingMain = false;
    resizingMain = false;
    resizeCornerMain = null;
    draggingSide = false;
    resizingSide = false;
    resizeCornerSide = null;
});
// --- Toggle ROI edit mode với E/S: chỉnh sửa cả 2 ROI ---
document.addEventListener('keydown', function (e) {
    if (e.key === 'e' || e.key === 'E') {
        eCount++;
        if (eCount === 3) {
            eCount = 0;
            roiEditable = true;
            roiToast.textContent = 'ROI edit mode: ON (both ROIs)';
            roiToast.style.display = 'block';
            setTimeout(() => { roiToast.style.display = 'none'; roiToast.textContent = 'ROI configuration saved!'; }, 2000);
        }
        sCount = 0;
    } else if (e.key === 's' || e.key === 'S') {
        sCount++;
        if (sCount === 3) {
            sCount = 0;
            roiEditable = false;
            roiToast.textContent = 'ROI edit mode: OFF & ROI configuration saved!';
            roiToast.style.display = 'block';
            setTimeout(() => { roiToast.style.display = 'none'; roiToast.textContent = 'ROI configuration saved!'; }, 2000);
            // Lưu roi chính vào roi-config.txt (API cũ)
            saveRoiToServer();
            // Lưu sideDetectRoi vào side_detect_roi.txt (API mới)
            saveSideDetectRoiToTxt();
        }
        eCount = 0;
    } else {
        sCount = 0;
        eCount = 0;
    }
});
// Hàm chuyển blob sang base64
async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
// Hàm gửi ảnh OCR lên API và hiển thị kết quả
async function processCombinedOCR(blob, onlyRenderSide = false) {
    try {
        let ocrArr = [];
        // Nếu chỉ render lại bảng để update dòng side
        if (onlyRenderSide) {
            // Lấy lại dữ liệu từ bảng hiện tại (nếu có)
            const ocrTable = document.querySelector('.ocr-table');
            if (ocrTable) {
                // Lấy các giá trị từ cột "Original"
                const inputs = ocrTable.querySelectorAll('tr .ocr-cell.ocr-origin input');
                ocrArr = Array.from(inputs).map(input => input.value);
            }
        } else {
            // Fetch prompt from external file
            const promptRes = await fetch('/static/prompt.md');
            const prompt = await promptRes.text();

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2.5vl:3b',
                    prompt: prompt,
                    "format": 'json',
                    "options": { "temperature": 0 },
                    images: [await blobToBase64(blob)],
                    stream: false
                })
            });
            const data = await response.json();
            try {
                // Parse JSON result from API response
                const json = JSON.parse(data.response);
                // Đúng format API trả về: chỉ có 6 dòng (line1-line6)
                ocrArr = [
                    json.line1 || '',
                    json.line2 || '',
                    json.line3 || '',
                    json.line4 || '',
                    json.line5 || '',
                    json.line6 || ''
                ];
            } catch (e) {
                ocrArr = [];
            }
        }
        let shoeErrors = [];
        try {
            const res = await fetch('https://10.13.32.51:8443/fetch-shoe-errors');
            const data = await res.json();
            // --- Sửa: Nếu trả về { shoe_errors: [...] } thì lấy đúng key ---
            if (Array.isArray(data.shoe_errors)) {
                shoeErrors = data.shoe_errors.map((name, idx) => ({
                    id: idx + 1,
                    name: name
                }));
            } else if (Array.isArray(data)) {
                shoeErrors = data.map((item, idx) => ({
                    id: idx + 1,
                    name: item
                }));
            }
        } catch (err) {
            console.warn('Không thể load danh sách lỗi từ API:', err);
        }
        const container = document.getElementById('ocrResultsContainer');
        container.innerHTML = '';
        const ocrPanel = document.getElementById('right-panel');
        // Kiểm tra đúng 6 dòng (line1-line6)
        if (ocrArr.length === 6) {
            // Tách dòng 4 (ocrArr[3]) thành 2 phần nếu có dấu cách
            const line4 = ocrArr[2];
            const lastSpaceIdx = line4.lastIndexOf(' ');
            let part1 = line4, part2 = '';
            if (lastSpaceIdx !== -1) {
                part1 = line4.substring(0, lastSpaceIdx);
                part2 = line4.substring(lastSpaceIdx + 1);
            }
            const displayArr = [
                ocrArr[0] || '',
                ocrArr[1] || '',
                ocrArr[2] || '',
                part1 || '',
                part2 || '',
                // ocrArr[3] || '',
                // ocrArr[4] || '',
                // ocrArr[5] || ''
            ];
            // Levenshtein + dictionary
            function levenshtein(a, b) {
                const m = a.length, n = b.length;
                const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
                for (let i = 0; i <= m; i++) dp[i][0] = i;
                for (let j = 0; j <= n; j++) dp[0][j] = j;
                for (let i = 1; i <= m; i++) {
                    for (let j = 1; j <= n; j++) {
                        dp[i][j] = Math.min(
                            dp[i - 1][j] + 1,
                            dp[i][j - 1] + 1,
                            dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                        );
                    }
                }
                return dp[m][n];
            }
            function correctByDictionary(word) {
                if (!dictionary || dictionary.length === 0) return word;

                // Nếu từ đã có trong dictionary thì giữ nguyên, không sửa
                if (dictionary.includes(word)) return word;

                // Ưu tiên kiểm tra nếu word chỉ dư 1 ký tự ở đầu/cuối so với một từ trong dictionary
                for (const dictWord of dictionary) {
                    if (
                        word.length === dictWord.length + 1 &&
                        (word.startsWith(dictWord) || word.endsWith(dictWord))
                    ) {
                        // Nhưng chỉ nhận nếu KHÔNG có từ nào trong dictionary là substring của word (trừ ký tự dư)
                        // Nếu có từ trong dictionary là substring đúng vị trí, ưu tiên trả về từ đó
                        for (const d2 of dictionary) {
                            if (d2.length === word.length && d2 === word) return d2;
                            if (d2.length === word.length - 1 && word.includes(d2)) {
                                // Nếu phần dư là 1 ký tự ở giữa, không sửa
                                // Nếu phần dư là ở đầu/cuối, ưu tiên d2 nếu d2 khác dictWord
                                if (d2 !== dictWord) return d2;
                            }
                        }
                        // Nếu không có từ nào khác phù hợp hơn, mới trả về dictWord
                        return dictWord;
                    }
                }
                // Nếu không match theo kiểu dư đầu/cuối, dùng Levenshtein như cũ
                let minDist = Infinity, best = word;
                for (const dictWord of dictionary) {
                    const dist = levenshtein(word, dictWord);
                    if (dist < minDist) {
                        minDist = dist;
                        best = dictWord;
                    }
                }
                if (best !== word && minDist < 3) return best;
                return word;
            }
            // Sửa riêng cho part1 (giữa MS và WS)
            function fixPart1(val) {
                // Ghép lại nếu có khoảng trắng giữa các phần
                let compactVal = val.replace(/\s+/g, '');
                let result = compactVal;
                let changed = false;
                result = result.replace(/([A-Za-z]+)(\d+(?:-\d+)?)(?=[A-Za-z]|$)/g, function (_, prefix, num) {
                    // Xử lý đặc biệt nếu num là "111"
                    if (num === "111") {
                        changed = true;
                        return prefix + "11";
                    }
                    // Nếu có dấu gạch ngang (range size): xử lý ví dụ như "10-105" => "10-10.5", "1-15" => "1-1.5"
                    if (/^\d+-\d+$/.test(num)) {
                        let [left, right] = num.split('-');
                        // Nếu đã hợp lệ trong dictionary
                        if (dictionary.includes(num)) {
                            changed = true;
                            return prefix + num;
                        }
                        // Thử chuyển phần sau thành x.x
                        if (right.length === 3) {
                            let fixedRight = right[0] + right[1] + '.' + right[2]; // ví dụ 105 -> 10.5
                            let candidate = `${left}-${fixedRight}`;
                            if (parseFloat(fixedRight) <= 16 && dictionary.includes(candidate)) {
                                changed = true;
                                return prefix + candidate;
                            }
                        }
                        if (right.length === 2) {
                            let fixedRight = right[0] + '.' + right[1]; // ví dụ 15 -> 1.5
                            let candidate = `${left}-${fixedRight}`;
                            if (parseFloat(fixedRight) <= 16 && dictionary.includes(candidate)) {
                                changed = true;
                                return prefix + candidate;
                            }
                        }
                        return prefix + num; // fallback
                    }
                    // Nếu num có 3 chữ số, ví dụ: 105, 555, 450
                    if (/^\d{3}$/.test(num)) {
                        // Cách 1: xx.x, ví dụ 105 -> 10.5
                        let xx1 = num[0] + num[1] + '.' + num[2];
                        if (parseFloat(xx1) <= 16 && dictionary.includes(xx1)) {
                            changed = true;
                            return prefix + xx1;
                        }

                        // Cách 2: x.y, ví dụ 555 -> 5.5
                        let xx2 = num[0] + '.' + num[1];
                        if (parseFloat(xx2) <= 16 && dictionary.includes(xx2)) {
                            changed = true;
                            return prefix + xx2;
                        }
                        // Cách 3: nếu là x50 thì -> x.5 (ví dụ 450 -> 4.5)
                        if (num[1] === '5' && num[2] === '0') {
                            let x5 = num[0] + '.5';
                            if (dictionary.includes(x5)) {
                                changed = true;
                                return prefix + x5;
                            }
                        }
                        // Cách 4: nếu là x00 -> x.0 (ví dụ 400 -> 4), loại bỏ phần thập phân
                        if (num[1] === '0' && num[2] === '0') {
                            let x = num[0];
                            if (dictionary.includes(x)) {
                                changed = true;
                                return prefix + x;
                            }
                        }
                    }
                    // Nếu là 2 chữ số (ví dụ 40, 45) → thử chuyển thành x.y
                    if (/^\d{2}$/.test(num)) {
                        let val1 = num[0] + '.' + num[1];
                        if (parseFloat(val1) <= 16 && dictionary.includes(val1)) {
                            changed = true;
                            return prefix + val1;
                        }
                        // Loại bỏ nhánh này để không sửa "10" thành "1"
                        // if (num[1] === '0' && dictionary.includes(num[0])) {
                        //     changed = true;
                        //     return prefix + num[0];
                        // }
                    }
                    // Nếu là số bình thường đã đúng
                    if (dictionary.includes(num)) {
                        return prefix + num;
                    }
                    // Thử chèn dấu '.' vào mọi vị trí
                    for (let i = 1; i < num.length; ++i) {
                        let candidate = num.slice(0, i) + '.' + num.slice(i);
                        if (parseFloat(candidate) <= 16 && dictionary.includes(candidate)) {
                            changed = true;
                            return prefix + candidate;
                        }
                    }
                    return prefix + num; // fallback giữ nguyên
                });
                // Trường hợp đặc biệt: "15" và "1.5" đều trong dictionary
                if (
                    /([A-Za-z]+)15([A-Za-z]*)$/.test(compactVal) &&
                    dictionary.includes("15") && dictionary.includes("1.5")
                ) {
                    let prefix = compactVal.match(/([A-Za-z]+)15([A-Za-z]*)$/)[1];
                    let suffix = compactVal.match(/([A-Za-z]+)15([A-Za-z]*)$/)[2];
                    return [
                        `${prefix}15${suffix}`,
                        `${prefix}1.5${suffix}`
                    ];
                }

                return [result];
            }
            // Sửa các dòng khác như cũ
            let fixedArr = displayArr.map((val, idx) => {
                if (dictionary && dictionary.length > 0) {
                    if (idx === 3) return fixPart1(val);
                    return correctByDictionary(val);
                }
                return val;
            });
            // --- Sửa: KHÔNG sửa line1 ngay, chỉ sửa các dòng khác ---
            // Lưu lại các giá trị cần cho fetch-moldip-for-line1 khi chọn Side
            let mold_id = Array.isArray(fixedArr[1]) ? fixedArr[1][0] : fixedArr[1];
            let sizeList = [];
            let shift = Array.isArray(fixedArr[4]) ? fixedArr[4][0] : fixedArr[4];
            // Lấy sizeList như cũ
            {
                // Lấy tất cả giá trị size đã sửa từ các input trong cột "Đã sửa" (ocr-cell ocr-fixed) của hàng part1 (STT 4)
                // (Chúng ta sẽ lấy lại sau khi render bảng, hoặc lấy từ fixedArr[3])
                if (Array.isArray(fixedArr[3])) {
                    sizeList = fixedArr[3].map(x => {
                        // Ưu tiên lấy chuỗi dạng số hoặc số có dấu gạch sau MS, trước WS (nếu có)
                        let match = x.match(/MS\s*([0-9.\-]+)(?=WS|$)/i);
                        let raw = match ? match[1] : '';
                        if (!raw) return '';
                        let num = raw;
                        // Nếu số lớn hơn 16, thử chuyển thành số thập phân
                        let n = parseFloat(num);
                        if (n > 16) {
                            // Nếu có 3 chữ số, chuyển thành x.y (450 -> 4.5)
                            if (/^\d{3}$/.test(num)) {
                                num = num[0] + '.' + num.slice(1, 3);
                            }
                            // Nếu có 2 chữ số cuối là 50, chuyển thành x.5 (450 -> 4.5)
                            else if (/^\d+50$/.test(num)) {
                                num = num.slice(0, -2) + '.5';
                            }
                            // Nếu có 1 chữ số cuối là 0, chuyển thành x.0 (40 -> 4.0)
                            else if (/^\d+0$/.test(num)) {
                                // Nếu là 40 thì thành 4, còn lại thì giữ nguyên
                                if (num === "40") num = "4";
                                else num = num.slice(0, -1) + '.0';
                            }
                            // Trường hợp đặc biệt: 115 -> 11.5, 145 -> 14.5
                            else if (num === "115") {
                                num = "11.5";
                            } else if (num === "145") {
                                num = "14.5";
                            }
                            // Sau khi chuyển, nếu vẫn lớn hơn 16, lấy số nhỏ hơn hoặc bằng 16 trong chuỗi
                            let n2 = parseFloat(num);
                            if (n2 > 16) {
                                let allNums = x.match(/[0-9.\-]+/g);
                                if (allNums) {
                                    let found = allNums.find(xx => {
                                        // Nếu là dạng 11-11.5 thì không parseFloat, giữ nguyên
                                        if (/^\d+-\d+(\.\d+)?$/.test(xx)) return true;
                                        return parseFloat(xx) <= 16;
                                    });
                                    if (found) num = found;
                                }
                            }
                        }
                        return num;
                    }).filter(Boolean);
                } else if (typeof fixedArr[3] === 'string') {
                    sizeList = [fixedArr[3]];
                }
            }

            // --- Render bảng OCR, KHÔNG sửa line1 ngay ---
            let html = `
<div class="ocr-title" style="margin-bottom:10px;">Kết quả OCR</div>
<div class="ocr-result-wrapper">
  <table class="ocr-table" style="width:100%;max-width:700px;">
    <thead>
      <tr>
        <th class="ocr-th-stt">STT.</th>
        <th class="ocr-th-origin">Bản gốc</th>
        <th class="ocr-th-fixed" id="corrected-th">Chỉnh sửa (nếu có)</th>
      </tr>
    </thead>
    <tbody>`;
            for (let i = 0; i < displayArr.length; ++i) {
                html += `<tr>
      <td class="stt">${i + 1}</td>
      <td>
        <div class="ocr-cell ocr-origin">
          <input type="text" value="${displayArr[i]}" readonly>
        </div>
      </td>`;
                // Only show "Corrected" column for No. 1, 2, part1/part2
                if (i === 0) {
                    // --- Không sửa line1 ngay, chỉ sửa các dòng khác ---
                    html += `<td>
                    <div class="ocr-cell ocr-fixed">
                        <input type="text" value="" readonly class="fixed" id="line1-fixed-input">
                        <button class="add-example-btn" data-line="1" title="Add example" style="margin-left:7px;font-size:18px;padding:2px 8px;border-radius:7px;border:1.5px solid #2563eb;background:#f1f5ff;color:#2563eb;cursor:pointer;">+</button>
                    </div>
                </td>`;
                } else if (i === 1) {
                    html += `<td>
                    <div class="ocr-cell ocr-fixed">
                        ${Array.isArray(fixedArr[i]) ? fixedArr[i].map(fixedVal => `<input type="text" value="${fixedVal}" readonly class="fixed multi">`).join('') : `<input type="text" value="${fixedArr[i]}" readonly class="fixed">`}
                        <button class="add-example-btn" data-line="2" title="Add example" style="margin-left:7px;font-size:18px;padding:2px 8px;border-radius:7px;border:1.5px solid #2563eb;background:#f1f5ff;color:#2563eb;cursor:pointer;">+</button>
                    </div>
                </td>`;
                } else if (i === 2) {
                    html += `<td>
                    <div class="ocr-cell ocr-fixed">
                        ${Array.isArray(fixedArr[i]) ? fixedArr[i].map(fixedVal => `<input type="text" value="${fixedVal}" readonly class="fixed multi">`).join('') : `<input type="text" value="${fixedArr[i]}" readonly class="fixed">`}
                        <button class="add-example-btn" data-line="3" title="Add example" style="margin-left:7px;font-size:18px;padding:2px 8px;border-radius:7px;border:1.5px solid #2563eb;background:#f1f5ff;color:#2563eb;cursor:pointer;">+</button>
                    </div>
                </td>`;
                } else if (i === 3 || i === 4) {
                    html += `<td>
          <div class="ocr-cell ocr-fixed">`;
                    if (Array.isArray(fixedArr[i])) {
                        // Nếu là dòng 4 (i==3) và có 2 giá trị, thêm class 'selectable-size'
                        for (let idx = 0; idx < fixedArr[i].length; ++idx) {
                            html += `<input type="text" value="${fixedArr[i][idx]}" readonly class="fixed multi selectable-size">`;
                        }
                    } else {
                        html += `<input type="text" value="${fixedArr[i]}" readonly class="fixed">`;
                    }
                    html += `</div></td>`;
                } else {
                    html += `<td><div class="ocr-cell"></div></td>`;
                }
                html += `</tr>`;
            }
            // --- Thêm dòng hiển thị kết quả side với 2 nút L/R ---
            html += `<tr>
                <td class="stt">${displayArr.length + 1}</td>
                <td>
                    <div class="ocr-cell ocr-origin">
                        <input type="text" value="Loại đế" readonly>
                    </div>
                </td>
                <td>
                    <div class="ocr-cell ocr-fixed">
                        <button class="side-btn" data-side="L" style="margin-right:8px;">Trái</button>
                        <button class="side-btn" data-side="R">Phải</button>
                    </div>
                </td>
            </tr>`;
            // --- Thay thế dòng "Inkjet Time" bằng 5 select inline (MM-dd HH:mm:ss) ---
            // Parse defaults từ lastYellowText nếu có
            let defM = '', defD = '', defH = '', defMin = '', defS = '';
            if (typeof lastYellowText === 'string') {
                const m = lastYellowText.match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
                if (m) {
                    defM = m[1]; defD = m[2]; defH = m[3]; defMin = m[4]; defS = m[5];
                }
            }
            const monthOpts = Array.from({ length: 12 }, (_, i) => {
                const v = String(i + 1).padStart(2, '0');
                return `<option value="${v}" ${defM === v ? 'selected' : ''}>${v}</option>`;
            }).join('');
            const dayOpts = Array.from({ length: 31 }, (_, i) => {
                const v = String(i + 1).padStart(2, '0');
                return `<option value="${v}" ${defD === v ? 'selected' : ''}>${v}</option>`;
            }).join('');
            const hourOpts = Array.from({ length: 24 }, (_, i) => {
                const v = String(i).padStart(2, '0');
                return `<option value="${v}" ${defH === v ? 'selected' : ''}>${v}</option>`;
            }).join('');
            const minSecOpts = Array.from({ length: 60 }, (_, i) => {
                const v = String(i).padStart(2, '0');
                return `<option value="${v}" ${defMin === v ? 'selected' : ''}>${v}</option>`;
            }).join('');
            const secOpts = Array.from({ length: 60 }, (_, i) => {
                const v = String(i).padStart(2, '0');
                return `<option value="${v}" ${defS === v ? 'selected' : ''}>${v}</option>`;
            }).join('');

            // --- Thay thế dòng cũ (input readonly) bằng các select có label trên cùng 1 dòng ---
            html += `<tr>
            <td class="stt">${displayArr.length + 1}</td>
            <td>
                <div class="ocr-cell ocr-origin">
                    <input type="text" value="Thời gian phun mực" readonly>
                </div>
            </td>
            <td>
                <div class="ocr-cell ocr-fixed">
                    <div class="inkjet-selects" style="
    display: flex;
    flex-direction: column;
    gap: 10px;
">
    <!-- Hàng 1: Month + Day -->
    <div style="display: flex; gap: 10px;">
        <div class="ink-col" style="display:flex;flex-direction:column;align-items:flex-start;">
            <div class="ink-label" style="font-size:12px;color:#60a5fa;margin-bottom:4px;">Tháng</div>
            <select id="ink-month" class="ink-sel" style="padding:6px 10px;border:1.5px solid #d1d5db;border-radius:8px;min-width:68px;text-align:center;">${monthOpts}</select>
        </div>
        <div class="ink-col" style="display:flex;flex-direction:column;align-items:flex-start;">
            <div class="ink-label" style="font-size:12px;color:#60a5fa;margin-bottom:4px;">Ngày</div>
            <select id="ink-day" class="ink-sel" style="padding:6px 10px;border:1.5px solid #d1d5db;border-radius:8px;min-width:68px;text-align:center;">${dayOpts}</select>
        </div>
    </div>

    <!-- Hàng 2: Hour + Min + Sec -->
    <div style="display: flex; gap: 10px;">
        <div class="ink-col" style="display:flex;flex-direction:column;align-items:flex-start;">
            <div class="ink-label" style="font-size:12px;color:#60a5fa;margin-bottom:4px;">Giờ</div>
            <select id="ink-hour" class="ink-sel" style="padding:6px 10px;border:1.5px solid #d1d5db;border-radius:8px;min-width:68px;text-align:center;">${hourOpts}</select>
        </div>
        <div class="ink-col" style="display:flex;flex-direction:column;align-items:flex-start;">
            <div class="ink-label" style="font-size:12px;color:#60a5fa;margin-bottom:4px;">Phút</div>
            <select id="ink-min" class="ink-sel" style="padding:6px 10px;border:1.5px solid #d1d5db;border-radius:8px;min-width:68px;text-align:center;">${minSecOpts}</select>
        </div>
        <div class="ink-col" style="display:flex;flex-direction:column;align-items:flex-start;">
            <div class="ink-label" style="font-size:12px;color:#60a5fa;margin-bottom:4px;">Giây</div>
            <select id="ink-sec" class="ink-sel" style="padding:6px 10px;border:1.5px solid #d1d5db;border-radius:8px;min-width:68px;text-align:center;">${secOpts}</select>
        </div>
    </div>
</div>

                </div>
            </td>
        </tr>`;

            // --- Thêm dòng Color Way ---
            html += `<tr id="color-way-row">
                <td class="stt">${displayArr.length + 3}</td>
                <td>
                    <div class="ocr-cell ocr-origin">
                        <input type="text" value="Mã màu" readonly>
                    </div>
                </td>
                <td>
                    <div class="ocr-cell ocr-fixed" style="position:relative;">
                        <input type="text" value="" class="fixed" id="color-way-input" autocomplete="off">
                        <div id="color-way-suggest" style="position:absolute;top:100%;left:0;right:0;z-index:99;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.07);display:none;max-height:180px;overflow-y:auto;"></div>
                    </div>
                </td>
            </tr>`;
            html += `</tbody></table></div>
    `;
            // --- Sửa: Dùng số dòng động cho Error row, đồng bộ style và vị trí ---
            let errorRowNumber = displayArr.length + 2;
            let errorRowHtml = `
    <tr class="error-row" data-error-index="1">
        <td class="stt">${errorRowNumber}</td>
        <td>
            <div class="ocr-cell ocr-origin">
                <input type="text" value="Lỗi" readonly>
            </div>
        </td>
        <td>
            <div class="ocr-cell ocr-fixed error-select-wrapper">
                <select class="error-select" style="padding:7px 12px;border-radius:8px;border:1.5px solid #ef4444;font-size:15px;color:#ef4444;background:#fff;">
                    <option value="">--</option>
                    ${shoeErrors.map(err => `<option value="${err.id}">${err.id}. ${err.name}</option>`).join('')}
                </select>
                <button class="add-error-btn" style="margin-left: 8px; padding: 7px 18px; border-radius: 8px; border: 1.5px solid #2563eb; background-color: #f1f5ff; color: #2563eb; font-size: 15px; font-weight:600; cursor:pointer;">+</button>
            </div>
        </td>
    </tr>
    `;

            // --- Thêm errorRowHtml vào đúng tbody của bảng ---
            // Đầu tiên, render bảng như cũ
            container.innerHTML = html;
            // Sau đó, chèn errorRowHtml vào cuối tbody (trước khi đóng </tbody>)
            const tbody = container.querySelector('.ocr-table tbody');
            if (tbody) {
                tbody.insertAdjacentHTML('beforeend', errorRowHtml);
            }

            // --- Gắn event cho nút + sau khi render bảng ---
            document.querySelectorAll('.add-example-btn, .add-error-btn').forEach(btn => {
                btn.onclick = function () {
                    // Nếu là add-error-btn (row 9), thêm dòng error mới bên dưới
                    if (btn.classList.contains('add-error-btn')) {
                        // Tìm tbody và vị trí row hiện tại
                        const tr = btn.closest('tr');
                        const tbody = tr.parentNode;
                        // Đếm số error-row hiện tại để đánh số tiếp theo
                        let errorRows = tbody.querySelectorAll('tr.error-row');
                        if (errorRows.length >= 3) {
                            btn.disabled = true; // Disable nút nếu đã đạt giới hạn
                            return;
                        }
                        let nextIndex = errorRows.length + 1;
                        // Lấy danh sách shoeErrors (có thể lấy lại từ biến shoeErrors nếu cần)
                        let shoeErrors = [];
                        try {
                            const ocrTable = document.querySelector('.ocr-table');
                            if (ocrTable) {
                                const options = ocrTable.querySelectorAll('.error-select option');
                                shoeErrors = Array.from(options)
                                    .filter(opt => opt.value && opt.value !== "")
                                    .map((opt, idx) => ({ id: idx + 1, name: opt.text.replace(/^\d+\.\s*/, '') }));
                            }
                        } catch (e) { }
                        // Tạo HTML cho error row mới
                        let errorRowHtml = `
<tr class="error-row" data-error-index="${nextIndex}">
    <td class="stt">${parseInt(tr.querySelector('.stt').textContent, 10) + 1}</td>
    <td>
        <div class="ocr-cell ocr-origin">
            <input type="text" value="Lỗi" readonly>
        </div>
    </td>
    <td>
        <div class="ocr-cell ocr-fixed error-select-wrapper">
            <select class="error-select" style="padding:7px 12px;border-radius:8px;border:1.5px solid #ef4444;font-size:15px;color:#ef4444;background:#fff;">
                <option value="">--</option>
                ${shoeErrors.map(err => `<option value="${err.id}">${err.id}. ${err.name}</option>`).join('')}
            </select>
            
        </div>
    </td>
</tr>
`;
                        // Chèn sau row hiện tại
                        tr.insertAdjacentHTML('afterend', errorRowHtml);
                        // Cập nhật lại số thứ tự cho các dòng sau (nếu có)
                        let rows = Array.from(tbody.querySelectorAll('tr'));
                        let startIdx = rows.indexOf(tr) + 1;
                        for (let i = startIdx; i < rows.length; ++i) {
                            let sttCell = rows[i].querySelector('.stt');
                            if (sttCell) sttCell.textContent = i + 1;
                        }
                        // Gắn lại event cho nút + mới

                        return;
                    }
                    // Mặc định cho các dòng khác
                    const line = parseInt(btn.getAttribute('data-line'), 10);
                    let input = btn.parentNode.querySelector('input.fixed, input#line1-fixed-input');
                    let val = input ? input.value : '';
                    showAddExampleDialog(line, val);
                };
            });
            // --- Gắn event chọn size cho dòng 4 nếu có nhiều input ---
            // Chỉ cho phép chọn 1 input trong các input.selectable-size
            const selectableInputs = document.querySelectorAll('tr:nth-child(4) .ocr-fixed .selectable-size');
            if (selectableInputs.length > 1) {
                selectableInputs.forEach(inp => {
                    inp.addEventListener('click', function () {
                        selectableInputs.forEach(i => i.classList.remove('selected'));
                        inp.classList.add('selected');
                    });
                });
            }
            // --- Xử lý sự kiện click cho nút Side ---
            const sideBtns = container.querySelectorAll('.side-btn');
            const line1FixedInput = container.querySelector('#line1-fixed-input');
            const correctedTh = container.querySelector('#corrected-th');
            const colorWayInput = container.querySelector('#color-way-input');
            await autoFetchAndFixLine1({
                mold_id,                 // đã tính ở trên từ fixedArr
                sizeList,                // đã tính ở trên
                shift,                   // đã tính ở trên
                side: '',                // bỏ L/R theo yêu cầu
                line1Origin: displayArr[0] || '',
                correctedThEl: correctedTh,
                line1FixedInputEl: line1FixedInput
            });
            let selectedSide = null;
            sideBtns.forEach(btn => {
                btn.addEventListener('click', async function () {
                    // Highlight nút đã chọn
                    sideBtns.forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');

                    // Lưu giá trị side
                    selectedSide = btn.getAttribute('data-side');
                    console.log("Side được chọn:", selectedSide);
                    // Nếu có size thì lấy cái đầu tiên làm selectedSize (hoặc có thể tùy theo người chọn)

                });
            });
            // sideBtns.forEach(btn => {
            //     btn.addEventListener('click', async function () {
            //         // Highlight nút đã chọn
            //         sideBtns.forEach(b => b.classList.remove('selected'));
            //         btn.classList.add('selected');
            //         const sideVal = btn.getAttribute('data-side');
            //         const shiftPattern = /^(A|B|C|D|E)([12])?$/;
            //         const validShift = (typeof shift === 'string' && shiftPattern.test(shift)) ? shift : '';
            //         // --- Lọc size hợp lệ ---
            //         const validSizes = [];
            //         const sizePattern = /^(\d{1,2})(?:-(\d{1,2}(?:\.5)?)|(?:\.5)?)?$/;

            //         for (const size of sizeList) {
            //             if (typeof size !== 'string') continue;
            //             const match = size.match(sizePattern);
            //             if (!match) continue;

            //             const base = parseFloat(match[1]);
            //             const ext = match[2] ? parseFloat(match[2]) : null;

            //             const isValid = (
            //                 base >= 1 && base <= 16 &&
            //                 (!ext || (ext >= 1 && ext <= 16)) &&
            //                 (ext === null || (ext === base + 0.5))
            //             );

            //             if (isValid) {
            //                 validSizes.push(size);
            //             }
            //         }

            //         try {
            //             const res = await fetch('/fetch-moldip-for-line1', {
            //                 method: 'POST',
            //                 headers: { 'Content-Type': 'application/json' },
            //                 body: JSON.stringify({
            //                     mold_id: mold_id,
            //                     size: validSizes.length > 0 ? validSizes : [],
            //                     shift: validShift,
            //                     side: sideVal
            //                 })
            //             });

            //             const data = await res.json();

            //             // --- Đếm số lượng kết quả ---
            //             let count = (data && Array.isArray(data.mold_ip_list)) ? data.mold_ip_list.length : 0;
            //             if (correctedTh) {
            //                 correctedTh.textContent = `Corrected (${count})`;
            //             }

            //             // --- SỬA LINE 1 TỪ DICTIONARY TRẢ VỀ ---
            //             let best = "";
            //             if (count > 0) {
            //                 const line1Origin = displayArr[0] || '';
            //                 function levenshtein(a, b) {
            //                     const m = a.length, n = b.length;
            //                     const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
            //                     for (let i = 0; i <= m; i++) dp[i][0] = i;
            //                     for (let j = 0; j <= n; j++) dp[0][j] = j;
            //                     for (let i = 1; i <= m; i++) {
            //                         for (let j = 1; j <= n; j++) {
            //                             dp[i][j] = Math.min(
            //                                 dp[i - 1][j] + 1,
            //                                 dp[i][j - 1] + 1,
            //                                 dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            //                             );
            //                         }
            //                     }
            //                     return dp[m][n];
            //                 }

            //                 best = data.mold_ip_list[0];
            //                 let minDist = levenshtein(line1Origin, best);
            //                 for (const cand of data.mold_ip_list) {
            //                     const dist = levenshtein(line1Origin, cand);
            //                     if (dist < minDist) {
            //                         minDist = dist;
            //                         best = cand;
            //                     }
            //                 }

            //                 if (line1FixedInput) {
            //                     line1FixedInput.value = best;
            //                     line1FixedInput.classList.add('fixed');
            //                 }
            //             } else {
            //                 if (line1FixedInput) {
            //                     line1FixedInput.value = '';
            //                 }
            //             }

            //             // --- GỌI API fetch-color-way ---
            //             // mold_ip là line1FixedInput.value (sau khi sửa)
            //             const colorWayRes = await fetch('http://10.13.34.180:5000/fetch-color-way', {
            //                 method: 'POST',
            //                 headers: { 'Content-Type': 'application/json' },
            //                 body: JSON.stringify({
            //                     mold_id: mold_id,
            //                     size: validSizes.length > 0 ? validSizes : [],
            //                     shift: validShift,
            //                     side: sideVal,
            //                     mold_ip: line1FixedInput.value || ""
            //                 })
            //             });
            //             const colorWayData = await colorWayRes.json();
            //             let colorWayVal = "";
            //             if (colorWayData && Array.isArray(colorWayData.color_ways) && colorWayData.color_ways.length > 0) {
            //                 colorWayVal = colorWayData.color_ways.join(', ');
            //             }
            //             if (colorWayInput) {
            //                 colorWayInput.value = colorWayVal;
            //             }
            //         } catch (err) {
            //             if (correctedTh) correctedTh.textContent = 'Corrected (0)';
            //             if (line1FixedInput) line1FixedInput.value = '';
            //             if (colorWayInput) colorWayInput.value = '';
            //         }
            //     });
            // });
        } else {
            // Nếu không có kết quả OCR JSON hợp lệ, hiển thị bảng chỉ có dòng Side
            container.innerHTML = `
                <div class="ocr-title" style="margin-bottom:10px;">Compare OCR Results</div>
                <div class="ocr-result-wrapper">
                  <table class="ocr-table" style="width:100%;max-width:700px;">
                    <thead>
                      <tr>
                        <th class="ocr-th-stt">STT.</th>
                        <th class="ocr-th-origin">Bản gốc</th>
                        <th class="ocr-th-fixed">Chỉnh sửa (nếu có)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="stt">1</td>
                        <td>
                          <div class="ocr-cell ocr-origin">
                            <input type="text" value="Side" readonly>
                          </div>
                        </td>
                        <td>
                          <div class="ocr-cell ocr-fixed">
                            <input type="text" value="${lastSideResult !== null ? lastSideResult : ''}" readonly class="fixed">
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
            `;
        }
        // --- Always show the right panel after rendering OCR results ---
        if (ocrPanel) ocrPanel.style.display = 'flex';
    } catch (error) {
        const container = document.getElementById('ocrResultsContainer');
        container.innerHTML = `<span style="color:#ef4444;font-size:16px;">Error: ${error.message}</span>`;
        const ocrPanel = document.getElementById('right-panel');
        // --- Always show the right panel even on error ---
        if (ocrPanel) ocrPanel.style.display = 'flex';
    }
}
// --- Helper: tự động fetch & sửa line1 bằng dictionary trả về từ /fetch-moldip-for-line1 ---
async function autoFetchAndFixLine1({ mold_id, sizeList, shift, side = '', line1Origin, correctedThEl, line1FixedInputEl }) {
    // Lọc size hợp lệ giống logic cũ
    const validSizes = [];
    const sizePattern = /^(\d{1,2})(?:-(\d{1,2}(?:\.5)?)|(?:\.5)?)?$/;
    for (const size of sizeList || []) {
        if (typeof size !== 'string') continue;
        const m = size.match(sizePattern);
        if (!m) continue;
        const base = parseFloat(m[1]);
        const ext = m[2] ? parseFloat(m[2]) : null;
        const ok = (
            base >= 1 && base <= 16 &&
            (!ext || (ext >= 1 && ext <= 16)) &&
            (ext === null || (ext === base + 0.5))
        );
        if (ok) validSizes.push(size);
    }

    try {
        const res = await fetch('/fetch-moldip-for-line1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nike_tool_code: mold_id || '',
                component_size: validSizes.length > 0 ? validSizes : [],
                mold_name: (typeof shift === 'string' && /^(A|B|C|D|E)([12])?$/.test(shift)) ? shift : '',
                // side // để trống vì đã bỏ L/R
            })
        });
        const data = await res.json();
        const list = (data && Array.isArray(data.mold_ip_list)) ? data.mold_ip_list : [];
        if (correctedThEl) correctedThEl.textContent = `Chỉnh sửa (${list.length})`;

        if (!list.length) {
            if (line1FixedInputEl) line1FixedInputEl.value = '';
            return;
        }

        // Giữ nguyên cách chọn best theo Levenshtein như logic hiện có
        function levenshtein(a, b) {
            const m = a.length, n = b.length;
            const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
            for (let i = 0; i <= m; i++) dp[i][0] = i;
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,
                        dp[i][j - 1] + 1,
                        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                    );
                }
            }
            return dp[m][n];
        }

        let best = list[0];
        let minDist = levenshtein(line1Origin || '', best);
        for (const cand of list) {
            const d = levenshtein(line1Origin || '', cand);
            if (d < minDist) { minDist = d; best = cand; }
        }

        if (line1FixedInputEl) {
            line1FixedInputEl.value = best;
            line1FixedInputEl.classList.add('fixed');
        }
    } catch (e) {
        if (correctedThEl) correctedThEl.textContent = 'Chỉnh sửa (0)';
        if (line1FixedInputEl) line1FixedInputEl.value = '';
    }
}

// --- Thông báo nổi toàn cục ở giữa màn hình ---
function showGlobalToast(msg, isSuccess = true) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        toast.style.position = 'fixed';
        toast.style.left = '50%';
        toast.style.top = '50%';
        toast.style.transform = 'translate(-50%, -50%)';
        toast.style.zIndex = 100001; // Đảm bảo toast nổi trên overlay (overlay z-index 100000)
        toast.style.minWidth = '180px';
        toast.style.maxWidth = '90vw';
        toast.style.padding = '18px 34px';
        toast.style.borderRadius = '16px';
        toast.style.fontSize = '19px';
        toast.style.fontWeight = '700';
        toast.style.boxShadow = '0 2px 24px rgba(0,0,0,0.18)';
        toast.style.transition = 'opacity 0.2s';
        toast.style.textAlign = 'center';
        // Đảm bảo toast được append trực tiếp vào body (không vào overlay)
        document.body.appendChild(toast);
    } else {
        // Nếu toast đang nằm trong overlay, chuyển ra ngoài body
        if (toast.parentNode && toast.parentNode !== document.body) {
            document.body.appendChild(toast);
        }
    }
    toast.textContent = msg;
    toast.style.background = isSuccess ? '#22c55e' : '#ef4444';
    toast.style.color = '#fff';
    toast.style.opacity = '1';
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 350);
    }, 1800);
}

// --- Hàm show dialog nhập example ---
function showAddExampleDialog(lineIdx, currentVal) {
    // Tạo dialog đơn giản
    const dialog = document.createElement('div');
    dialog.style.position = 'fixed';
    dialog.style.left = '0';
    dialog.style.top = '0';
    dialog.style.width = '100vw';
    dialog.style.height = '100vh';
    dialog.style.background = 'rgba(0,0,0,0.18)';
    dialog.style.display = 'flex';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    dialog.style.zIndex = 9999;

    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.borderRadius = '14px';
    box.style.boxShadow = '0 2px 16px rgba(0,0,0,0.13)';
    box.style.padding = '28px 32px 22px 32px';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.minWidth = '320px';

    const label = document.createElement('div');
    label.style.fontWeight = '600';
    label.style.fontSize = '17px';
    label.style.marginBottom = '12px';
    label.textContent = `Add example for line ${lineIdx}`;
    box.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentVal || '';
    input.style.fontSize = '16px';
    input.style.padding = '8px 12px';
    input.style.borderRadius = '8px';
    input.style.border = '1.5px solid #e5e7eb';
    input.style.marginBottom = '18px';
    input.style.width = '100%';
    box.appendChild(input);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '12px';

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Add';
    okBtn.style.background = '#2563eb';
    okBtn.style.color = '#fff';
    okBtn.style.fontWeight = '600';
    okBtn.style.border = 'none';
    okBtn.style.borderRadius = '8px';
    okBtn.style.padding = '7px 22px';
    okBtn.style.fontSize = '15px';
    okBtn.style.cursor = 'pointer';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.background = '#e5e7eb';
    cancelBtn.style.color = '#222';
    cancelBtn.style.fontWeight = '500';
    cancelBtn.style.border = 'none';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.padding = '7px 18px';
    cancelBtn.style.fontSize = '15px';
    cancelBtn.style.cursor = 'pointer';

    btnRow.appendChild(okBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(btnRow);

    dialog.appendChild(box);
    document.body.appendChild(dialog);

    input.focus();

    cancelBtn.onclick = () => document.body.removeChild(dialog);
    okBtn.onclick = async () => {
        const val = input.value.trim();
        if (!val) {
            input.style.border = '2px solid #ef4444';
            input.focus();
            return;
        }
        // Gửi API lên server
        let payload = {};
        if (lineIdx === 1) payload = { mold_ip: val };
        if (lineIdx === 2) payload = { mold_id: val };
        if (lineIdx === 3) payload = { line3: val };
        try {
            const res = await fetch('/add-example', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                input.style.border = '2px solid #22c55e';
                showGlobalToast('Added successfully!', true);
                setTimeout(() => document.body.removeChild(dialog), 600);
            } else {
                input.style.border = '2px solid #ef4444';
                showGlobalToast('Add failed!', false);
            }
        } catch (e) {
            input.style.border = '2px solid #ef4444';
            showGlobalToast('Add failed!', false);
        }
    };
}

// Hàm kiểm tra ROI hiện tại có ký tự dập nổi không (gọi olama)
// async function visibleText(blob) {
//     // Gửi ảnh lên API Flask để nhận diện text
//     const formData = new FormData();
//     formData.append('image', blob, 'roi.png');
//     formData.append('question', 'Transcribe the text');
//     try {
//         const response = await fetch('http://10.13.33.50:5000/query?stream=false', {
//             method: 'POST',
//             body: formData
//         });
//         const data = await response.json();
//         // data.answer là chuỗi trả về
//         if (data && typeof data.answer === 'string') {
//             return data.answer.length > 10;
//         }
//         return false;
//     } catch (e) {
//         return false;
//     }
// }
let currentRotatableBlob = null;

// Sau khi nhận ảnh crop từ API Python, gọi hàm này để OCR
// function handleCropAndOCR(blob) {
//     // Show cropped image larger
//     const leftBtn = document.getElementById('rotate-left');
//     const rightBtn = document.getElementById('rotate-right');

//     resultDiv.innerHTML = '';
//     if (leftBtn) resultDiv.appendChild(leftBtn);
//     if (rightBtn) resultDiv.appendChild(rightBtn);

//     const croppedImg = new Image();
//     croppedImg.src = URL.createObjectURL(blob);
//     croppedImg.style.maxWidth = '98%';
//     croppedImg.style.maxHeight = '600px';
//     croppedImg.style.width = 'auto';
//     croppedImg.style.height = 'auto';
//     croppedImg.style.borderRadius = '12px';
//     croppedImg.style.boxShadow = '0 2px 12px rgba(34,197,94,0.09)';
//     resultDiv.appendChild(croppedImg);

//     currentRotatableBlob = blob;
//     // Kiểm tra có ký tự dập nổi không
//     visibleText(blob).then(hasText => {
//         if (hasText) {
//             // Có ký tự, xử lý OCR như cũ
//             processCombinedOCR(blob);
//         } else {
//             // Không có ký tự, render bảng với các dòng là N/A
//             const container = document.getElementById('ocrResultsContainer');
//             const ocrPanel = document.getElementById('right-panel');
//             // 6 dòng N/A + dòng Side (nếu có)
//             let html = `
//             <div class="ocr-title" style="margin-bottom:10px;">Compare OCR Results</div>
//             <div class="ocr-result-wrapper">
//               <table class="ocr-table" style="width:100%;max-width:700px;">
//                 <thead>
//                   <tr>
//                     <th class="ocr-th-stt">No.</th>
//                     <th class="ocr-th-origin">Original</th>
//                     <th class="ocr-th-fixed">Corrected (if any)</th>
//                   </tr>
//                 </thead>
//                 <tbody>`;
//             for (let i = 0; i < 6; ++i) {
//                 html += `<tr>
//                     <td class="stt">${i + 1}</td>
//                     <td>
//                       <div class="ocr-cell ocr-origin">
//                         <input type="text" value="N/A" readonly>
//                       </div>
//                     </td>
//                     <td>
//                       <div class="ocr-cell ocr-fixed">
//                         <input type="text" value="N/A" readonly class="fixed">
//                       </div>
//                     </td>
//                   </tr>`;
//             }
//             // Dòng Side
//             html += `<tr>
//                 <td class="stt">7</td>
//                 <td>
//                     <div class="ocr-cell ocr-origin">
//                         <input type="text" value="Side" readonly>
//                     </div>
//                 </td>
//                 <td>
//                     <div class="ocr-cell ocr-fixed">
//                         <input type="text" value="${lastSideResult !== null ? lastSideResult : ''}" readonly class="fixed">
//                     </div>
//                 </td>
//             </tr>`;
//             html += `</tbody></table></div>
//             `;
//             container.innerHTML = html;
//             if (ocrPanel) ocrPanel.style.display = 'flex';
//         }
//     });
// }
async function handleCropAndOCR(croppedBlob) {
    try {
        const leftBtn = document.getElementById('rotate-left');
        const rightBtn = document.getElementById('rotate-right');
        // Nếu bật Auto Rotate thì xoay trước qua API; nếu không thì giữ nguyên
        const useAutoRotate = !!autoRotateCheckbox?.checked;
        const finalBlob = useAutoRotate ? await rotateViaAPI(croppedBlob) : croppedBlob;
        currentRotatableBlob = finalBlob;
        if (resultDiv) {
            // LẤY NÚT TRƯỚC khi xóa


            // rồi mới xóa nội dung ảnh cũ
            resultDiv.textContent = ''; // an toàn hơn innerHTML

            // gắn lại nút (nếu có)
            if (leftBtn) resultDiv.appendChild(leftBtn);
            if (rightBtn) resultDiv.appendChild(rightBtn);

            const url = URL.createObjectURL(finalBlob);
            const imgEl = new Image();
            imgEl.src = url;
            imgEl.style.maxWidth = '98%';
            imgEl.style.maxHeight = '600px';
            imgEl.style.width = 'auto';
            imgEl.style.height = 'auto';
            imgEl.style.borderRadius = '12px';
            imgEl.style.boxShadow = '0 2px 12px rgba(34,197,94,0.09)';
            // imgEl.onload = () => URL.revokeObjectURL(url);
            resultDiv.appendChild(imgEl);
        }


        // // Gọi flow cũ: /query?stream=false qua visibleText(...) rồi processCombinedOCR(...)
        // // const hasText = await visibleText(finalBlob);   // HÀM CŨ CỦA BẠN
        // if (hasText) {
        //     await processCombinedOCR(finalBlob, false);   // HÀM CŨ CỦA BẠN
        // } else {
        //     // Render N/A: giữ style giống panel hiện tại của bạn
        //     const container = document.getElementById('ocrResultsContainer');
        //     const ocrPanel = document.getElementById('right-panel');
        //     const rows = Array.from({ length: 6 }).map((_, i) => `
        // <tr>
        //   <td class="stt">${i + 1}</td>
        //   <td><div class="ocr-cell ocr-origin"><input type="text" value="N/A" readonly></div></td>
        //   <td><div class="ocr-cell ocr-fixed"><input type="text" value="N/A" readonly class="fixed"></div></td>
        // </tr>`).join('');
        //     container.innerHTML = `
        // <div class="ocr-title" style="margin-bottom:10px;">Compare OCR Results</div>
        // <div class="ocr-result-wrapper">
        //   <table class="ocr-table" style="width:100%;max-width:700px;">
        //     <thead>
        //       <tr>
        //         <th class="ocr-th-stt">No.</th>
        //         <th class="ocr-th-origin">Original</th>
        //         <th class="ocr-th-fixed">Corrected (if any)</th>
        //       </tr>
        //     </thead>
        //     <tbody>${rows}</tbody>
        //   </table>
        // </div>`;
        //     if (ocrPanel) ocrPanel.style.display = 'flex';
        // }
        await processCombinedOCR(finalBlob, false);
    } catch (err) {
        console.error(err);
        const container = document.getElementById('ocrResultsContainer');
        container.innerHTML = `<span style="color:#ef4444;font-size:16px;">Error: ${err.message}</span>`;
        const ocrPanel = document.getElementById('right-panel');
        if (ocrPanel) ocrPanel.style.display = 'flex';
    }
}


async function rotateAndRerun(direction) {
    try {
        // Lấy blob hiện tại để xoay; fallback: lấy từ <img> trong #result nếu cần
        let blobToRotate = currentRotatableBlob;
        if (!blobToRotate) {
            const imgEl = document.querySelector('#result img');
            if (!imgEl) return;
            const res = await fetch(imgEl.src);
            blobToRotate = await res.blob();
        }

        // Gửi xoay 3° tới API rotate (output luôn PNG)
        const fd = new FormData();
        fd.append('image', blobToRotate, 'input.png');
        fd.append('direction', direction);  // 'cw' | 'ccw'
        fd.append('degrees', '3');          // mỗi lần 3°
        fd.append('output', 'png');         // luôn png

        const rotateRes = await fetch('http://10.13.34.180:5000/rotate', {
            method: 'POST',
            body: fd
        });
        if (!rotateRes.ok) throw new Error('Rotate API failed');

        // API trả về ảnh PNG đã xoay
        const rotatedBlob = await rotateRes.blob();
        currentRotatableBlob = rotatedBlob;

        // Update UI but keep rotate buttons inside #result
        const resultDiv = document.getElementById('result');
        const leftBtn = document.getElementById('rotate-left');
        const rightBtn = document.getElementById('rotate-right');

        resultDiv.innerHTML = '';
        if (leftBtn) resultDiv.appendChild(leftBtn);
        if (rightBtn) resultDiv.appendChild(rightBtn);

        const img = new Image();
        img.src = URL.createObjectURL(rotatedBlob);
        img.style.maxWidth = '98%';
        img.style.maxHeight = '600px';
        img.style.width = 'auto';
        img.style.height = 'auto';
        img.style.borderRadius = '12px';
        img.style.boxShadow = '0 2px 12px rgba(34,197,94,0.09)';
        resultDiv.appendChild(img);

        // Ngay sau khi xoay xong: tự gửi lại ảnh đã xoay cho query?stream=false
        // (tận dụng lại visibleText → nếu có text thì tiếp tục OCR)
        const hasText = await visibleText(rotatedBlob); // POST /query?stream=false như code hiện tại
        if (hasText) {
            await processCombinedOCR(rotatedBlob, false);
        } else {
            // Không có text: vẽ bảng N/A giống handleCropAndOCR nhánh else
            const container = document.getElementById('ocrResultsContainer');
            const ocrPanel = document.getElementById('right-panel');
            let html = `
        <div class="ocr-title" style="margin-bottom:10px;">Compare OCR Results</div>
        <div class="ocr-result-wrapper">
          <table class="ocr-table" style="width:100%;max-width:700px;">
            <thead>
              <tr>
                <th class="ocr-th-stt">No.</th>
                <th class="ocr-th-origin">Original</th>
                <th class="ocr-th-fixed">Corrected (if any)</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from({ length: 6 }).map((_, i) => `
                <tr>
                  <td class="stt">${i + 1}</td>
                  <td><div class="ocr-cell ocr-origin"><input type="text" value="N/A" readonly></div></td>
                  <td><div class="ocr-cell ocr-fixed"><input type="text" value="N/A" readonly class="fixed"></div></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
            container.innerHTML = html;
            if (ocrPanel) ocrPanel.style.display = 'flex';
        }
    } catch (err) {
        console.error(err);
    }
}
async function rotateViaAPI(inputBlob) {
    const form = new FormData();
    form.append('image', inputBlob, 'crop.png');
    const res = await fetch('http://10.13.34.180:5000/rotate2', {
        method: 'POST',
        body: form
    });
    if (!res.ok) {
        throw new Error('Rotate2 failed');
    }
    return await res.blob(); // ảnh PNG đã xoay
}
// --- Crop ảnh từ ROI bất kỳ, trả về blob ---
async function cropImageFromRoi(roiObj) {
    // Tạo canvas tạm để crop
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.round(roiObj.w / scale);
    tempCanvas.height = Math.round(roiObj.h / scale);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(
        img,
        Math.round(roiObj.x / scale),
        Math.round(roiObj.y / scale),
        Math.round(roiObj.w / scale),
        Math.round(roiObj.h / scale),
        0, 0,
        tempCanvas.width, tempCanvas.height
    );
    return new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
}

// Sửa lại captureBtn event để gọi handleCropAndOCR (đã là async)
// recognizeBtn.addEventListener('click', async () => {
//     if (!img || !uploadedFilename || !uploadedFileHex) {
//         resultDiv.innerHTML = '<span style="color:#ef4444;font-size:16px;">No image to crop!</span>';
//         return;
//     }
//     // --- OCR LOADING EFFECT ---
//     const ocrContainer = document.getElementById('ocrResultsContainer');
//     if (ocrContainer) {
//         ocrContainer.innerHTML = `
//                 <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:180px;">
//                     <div class="ocr-loading-spinner"></div>
//                     <div style="margin-top:12px;color:#2563eb;font-size:17px;font-weight:500;">Recognizing OCR...</div>
//                 </div>
//                 `;
//     }

//     // --- Không còn crop sideDetectRoi và gọi leftRightDetection nữa ---

//     // --- Crop ảnh chính (roi) và gửi lên /crop ---
//     fetch('/crop', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },

//         body: JSON.stringify({
//             filename: uploadedFilename,
//             filedata: uploadedFileHex,
//             roi: {
//                 x: roi.x,
//                 y: roi.y,
//                 w: roi.w,
//                 h: roi.h
//             },
//             scale: scale
//         })
//     })
//         .then(res => {
//             if (!res.ok) {
//                 res.json().then(data => {
//                 });
//                 return;
//             }
//             return res.blob();
//         })
//         .then(async blob => {
//             if (!blob) return;
//             await handleCropAndOCR(blob);
//         });
// });
recognizeBtn.addEventListener('click', async () => {
    if (!img || !uploadedFilename || !uploadedFileHex) {
        resultDiv.innerHTML = '<span style="color:#ef4444;font-size:16px;">No image to crop!</span>';
        return;
    }

    const ocrContainer = document.getElementById('ocrResultsContainer');
    if (ocrContainer) {
        ocrContainer.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:180px;">
        <div class="ocr-loading-spinner"></div>
        <div style="margin-top:12px;color:#2563eb;font-size:17px;font-weight:500;">Dang xu ly nhan dien...</div>
      </div>`;
    }

    try {
        const res = await fetch('/crop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: uploadedFilename,
                filedata: uploadedFileHex,
                roi: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
                scale: scale
            })
        });
        if (!res.ok) throw new Error('Crop failed');
        const blob = await res.blob();
        await handleCropAndOCR(blob);
    } catch (e) {
        console.error(e);
        if (ocrContainer) {
            ocrContainer.innerHTML = `<span style="color:#ef4444;font-size:16px;">Error: ${e.message}</span>`;
        }
    }
});


// Thêm biến lưu dictionary
let dictionary = [];

// Xử lý nút fetch dictionary
document.getElementById('fetch-dict-btn').addEventListener('click', async function () {
    const statusDiv = document.getElementById('dict-status');
    statusDiv.textContent = 'Fetching dictionary...';
    try {
        // Gửi request lấy dictionary từ backend
        const res = await fetch('/fetch-dictionary');
        if (!res.ok) throw new Error('Không thể fetch dictionary từ server');
        const data = await res.json();
        if (!Array.isArray(data.dictionary)) throw new Error('Dữ liệu dictionary không hợp lệ');
        dictionary = data.dictionary;
        statusDiv.textContent = `Fetched ${dictionary.length} dictionary values.`;
        console.log('Dictionary fetched, length:', dictionary.length);
    } catch (err) {
        statusDiv.textContent = 'Error: ' + err.message;
    }
});
// Hàm kiểm tra dictionary trước khi thao tác
function ensureDictionaryReady() {
    if (!dictionary || dictionary.length === 0) {
        document.getElementById('dict-status').textContent = 'Please fetch dictionary first!';
        return false;
    }
    return true;
}
// --- Render color buttons dưới canvas-container ---
async function renderColorButtons() {
    try {
        const res = await fetch('/fetch-button-data');
        if (!res.ok) throw new Error('Failed to fetch button data');






        const data = await res.json();
        if (!Array.isArray(data.buttons)) return;

        let btnContainer = document.getElementById('color-btn-container');
        if (!btnContainer) {
            btnContainer = document.createElement('div');
            btnContainer.id = 'color-btn-container';
            btnContainer.style.display = 'flex';
            btnContainer.style.gap = '12px';
            btnContainer.style.marginTop = '18px';
            btnContainer.style.flexWrap = 'wrap';
            const canvasContainer = document.getElementById('yellow-text-img-container');
            if (canvasContainer) {
                canvasContainer.parentNode.insertBefore(btnContainer, canvasContainer.nextSibling);
            }
        } else {
            btnContainer.innerHTML = '';
        }

        let yellowBtn = null;

        data.buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = 'color-btn';
            button.textContent = btn.label;
            button.title = btn.description || '';
            button.style.background = btn.color_code;
            button.style.color = btn.color_text || '#ffffff';
            button.style.border = '2px solid #e5e7eb';
            button.style.borderRadius = '8px';
            button.style.padding = '7px 18px';
            button.style.fontWeight = '600';
            button.style.fontSize = '15px';
            button.style.cursor = 'pointer';
            button.style.transition = 'box-shadow 0.15s, border 0.15s';
            button.setAttribute('data-id', btn.id);
            button.setAttribute('data-desc', btn.description || '');

            // Hiệu ứng selected
            button.addEventListener('click', function () {
                btnContainer.querySelectorAll('.color-btn.selected').forEach(b => b.classList.remove('selected'));
                button.classList.add('selected');
                selectedColorDesc = btn.description || '';
                // --- Khi chọn nút màu, gọi embossed_detect ---
                runEmbossedDetectWithColor(selectedColorDesc);
            });

            // --- Nếu title là "yellow text" (không phân biệt hoa thường), lưu lại để auto-select ---
            if ((btn.description || '').trim().toLowerCase() === 'yellow text') {
                yellowBtn = button;
            }

            btnContainer.appendChild(button);
        });

        if (!document.getElementById('color-btn-style')) {
            const style = document.createElement('style');
            style.id = 'color-btn-style';
            style.textContent = `
                .color-btn.selected {
                    outline: 3px solid #2563eb;
                    border: 2.5px solid #2563eb !important;
                    box-shadow: 0 2px 10px rgba(37,99,235,0.13);
                }
            `;
            document.head.appendChild(style);
        }

        // --- Auto-select yellow text button nếu có ---
        if (yellowBtn) {
            setTimeout(() => {
                yellowBtn.classList.add('selected');
                selectedColorDesc = yellowBtn.getAttribute('data-desc') || '';
                runEmbossedDetectWithColor(selectedColorDesc);
            }, 0);
        }
    } catch (e) {
        // Không render gì nếu lỗi
    }
}

let selectedDeviceId = "";
// let socket, deviceSelect;

// ✅ Kiểm soát việc khởi tạo socket
function initializeSocketOnce() {
    if (!socket) {
        socket = io();
        console.log("Socket initialized");

        // ✅ Đăng ký 1 lần duy nhất
        socket.on('device_connected', function (deviceList) {
            deviceSelect.innerHTML = '<option value="">-- Select Device --</option>';
            deviceList.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                deviceSelect.appendChild(opt);
            });

            if (selectedDeviceId && deviceList.includes(selectedDeviceId)) {
                deviceSelect.value = selectedDeviceId;
            } else {
                selectedDeviceId = "";
            }
        });

        // socket.on('image_uploaded', function (data) {
        //     const { device_id, image_base64 } = data;
        //     if (device_id === selectedDeviceId) {
        //         // --- Convert base64 to File and call handleFiles ---
        //         function base64ToFile(base64, filename) {
        //             let arr = base64.split(',');
        //             let mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
        //             let bstr = atob(arr[1]);
        //             let n = bstr.length;
        //             let u8arr = new Uint8Array(n);
        //             while (n--) {
        //                 u8arr[n] = bstr.charCodeAt(n);
        //             }
        //             return new File([u8arr], filename, { type: mime });
        //         }
        //         const file = base64ToFile(image_base64, 'from_socket.png');
        //         handleFiles([file]);
        //         // --- Update status as before ---
        //         const statusEl = document.getElementById("status");
        //         if (statusEl) statusEl.innerText = "📷 Image from device: " + device_id;
        //     }
        // });
        // socket.on('image_uploaded', async function (data) {
        //     const { device_id, image_url } = data;

        //     if (device_id === selectedDeviceId) {
        //         try {
        //             // 🧠 Fetch ảnh từ server
        //             const response = await fetch(image_url + '?t=' + Date.now()); // bust cache
        //             const blob = await response.blob();

        //             // 📂 Tạo file từ blob
        //             const filename = image_url.split('/').pop() || 'from_socket.jpg';
        //             const file = new File([blob], filename, { type: blob.type });

        //             // 🎯 Gọi handleFiles như cũ
        //             handleFiles([file]);
        //             // --- Auto click yellow text color button if exists ---
        //             setTimeout(() => {
        //                 // Tìm nút color-btn có data-desc là "yellow text" (không phân biệt hoa thường)
        //                 const btns = document.querySelectorAll('.color-btn');
        //                 for (const btn of btns) {
        //                     const desc = (btn.getAttribute('data-desc') || '').trim().toLowerCase();
        //                     if (desc === 'yellow text') {
        //                         btn.click();
        //                         break;
        //                     }
        //                 }
        //             }, 300); // Đợi một chút để handleFiles hoàn thành và nút được render

        //             // ✅ Cập nhật UI
        //             const statusEl = document.getElementById("status");
        //             if (statusEl) statusEl.innerText = "📷 Image from device: " + device_id;

        //         } catch (err) {
        //             console.error("❌ Lỗi khi fetch ảnh:", err);
        //         }
        //     }
        // });

    }
}
let employeeNo = '';
let productionShift = '';
window.addEventListener('DOMContentLoaded', () => {
    startWebcam();
    showEmployeeNoDialog();
    document.getElementById('fetch-dict-btn').click();
    renderColorButtons();
    deviceSelect = document.getElementById('device-select');

    // ✅ Gọi khởi tạo socket
    // initializeSocketOnce();
    const btnLeft = document.getElementById('rotate-left');
    const btnRight = document.getElementById('rotate-right');

    if (btnLeft) {
        btnLeft.addEventListener('click', async () => {
            btnLeft.disabled = true; btnRight.disabled = true;
            await rotateAndRerun('ccw');     // TRÁI → cw
            btnLeft.disabled = false; btnRight.disabled = false;
        });
    }
    if (btnRight) {
        btnRight.addEventListener('click', async () => {
            btnLeft.disabled = true; btnRight.disabled = true;
            await rotateAndRerun('cw');    // PHẢI → ccw
            btnLeft.disabled = false; btnRight.disabled = false;
        });
    }
    deviceSelect.addEventListener('change', function () {
        selectedDeviceId = deviceSelect.value;
    });

    const captureBtn = document.getElementById('capture-btn');
    if (captureBtn) {
        captureBtn.onclick = function () {
            if (!selectedDeviceId) {
                alert('Please select a device!');
                return;
            }

            console.log("Trigger capture to", selectedDeviceId);

            // 🔒 Disable tạm thời để tránh nhấn liên tục
            captureBtn.disabled = true;
            setTimeout(() => {
                captureBtn.disabled = false;
            }, 1000); // Khoảng delay  1 giây

            socket.emit('capture_photo', { device_id: selectedDeviceId });

            const statusEl = document.getElementById("status");
            if (statusEl) statusEl.innerText = "Sent capture command to " + selectedDeviceId;
        };
    }

    // --- Space to trigger Capture ---
    document.addEventListener('keydown', function (e) {
        // Only Space key
        if (e.code !== 'Space') return;

        // Avoid when typing in form fields
        const ae = document.activeElement;
        const isTyping = ae && (
            ae.tagName === 'INPUT' ||
            ae.tagName === 'TEXTAREA' ||
            ae.tagName === 'SELECT' ||
            ae.isContentEditable
        );
        if (isTyping) return;

        // Avoid before entering Employee No (overlay present)
        const overlay = document.getElementById('employee-no-overlay');
        if (overlay && document.body.contains(overlay)) return;

        // Prevent page scroll and trigger capture
        e.preventDefault();
        // const btn = document.getElementById('capture-btn');
        const btn = document.getElementById('webcam-capture');
        if (btn) btn.click();
    }, { passive: false });

    // Thêm sự kiện cho nút Save nếu cần xử lý
    const saveBtn = document.getElementById('ocr-save-btn');
    if (saveBtn) {
        saveBtn.onclick = async function () {
            const ocrTable = document.querySelector('.ocr-table');
            if (!ocrTable) return;

            // --- 1) LẤY TỪNG TRƯỜNG RÕ RÀNG (KHÔNG DÙNG correctedValues THEO INDEX NỮA) ---
            // Dòng 1: mold_ip (đã có id riêng)
            const mold_ip = (document.getElementById('line1-fixed-input')?.value || '').trim();

            // Dòng 2: mold_id (ô Corrected của hàng thứ 2)
            const mold_id = (ocrTable.querySelector('tbody tr:nth-child(2) .ocr-fixed input')?.value || '').trim();

            // Dòng 3: tool_code (ô Corrected của hàng thứ 3)
            const tool_code = (ocrTable.querySelector('tbody tr:nth-child(3) .ocr-fixed input')?.value || '').trim();

            // Dòng 4 (part1): danh sách size (ưu tiên input được chọn nếu có nhiều)
            const row4 = ocrTable.querySelector('tbody tr:nth-child(4)');
            let sizeList = [];
            if (row4) {
                const selectedSize = row4.querySelector('.ocr-fixed .selectable-size.selected');
                const sizeInputs = selectedSize ? [selectedSize] : row4.querySelectorAll('.ocr-fixed input');
                sizeList = Array.from(sizeInputs).map(inp => {
                    const val = inp.value || '';
                    // Ưu tiên lấy số giữa MS và WS
                    const m = val.match(/MS\s*([0-9.\-]+)(?=WS|$)/i) || val.match(/[0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?/);
                    return m ? (m[1] || m[0]) : '';
                }).filter(Boolean);
            }

            // Dòng 5 (part2): mold_name (A, B, C, D, E + có thể kèm số)
            const mold_name = (ocrTable.querySelector('tbody tr:nth-child(5) .ocr-fixed input')?.value || '').trim();

            // Hàng “Loại đế” (Side): lấy data-side ('L'/'R'), KHÔNG dùng textContent (“Trái/Phải”)
            const sideBtnSelected = ocrTable.querySelector('.ocr-fixed .side-btn.selected');
            const side_lr = sideBtnSelected ? (sideBtnSelected.getAttribute('data-side') || '').trim() : '';

            // “Thời gian phun mực”: ghép từ 5 select (MM-DD HH:MM:SS)
            const mSel = document.getElementById('ink-month');
            const dSel = document.getElementById('ink-day');
            const hSel = document.getElementById('ink-hour');
            const minSel = document.getElementById('ink-min');
            const sSel = document.getElementById('ink-sec');
            const yellowText = (mSel && dSel && hSel && minSel && sSel)
                ? `${mSel.value}-${dSel.value} ${hSel.value}:${minSel.value}:${sSel.value}` : '';

            // Mã màu
            const color_way_input = document.getElementById('color-way-input');
            const color_way = (color_way_input?.value || '').trim();

            // Các hàng “Lỗi” (tối đa 3): đọc theo thứ tự xuất hiện
            const errorSelects = ocrTable.querySelectorAll('.error-select');
            const errorTexts = Array.from(errorSelects).map(sel => {
                const opt = sel.options[sel.selectedIndex];
                if (!opt || !opt.value || opt.text.trim() === '--') return null;
                return opt.text;
            });
            const error_1 = errorTexts[0] ?? null;
            const error_2 = errorTexts[1] ?? null;
            const error_3 = errorTexts[2] ?? null;

            // --- 2) KIỂM TRA HỢP LỆ ---
            function isValidSize(sz) {
                if (typeof sz !== 'string') return false;
                sz = sz.trim();
                // n | n.5 (1..15) hoặc 16
                if (/^([1-9]|1[0-5])(\.5)?$/.test(sz)) return true;
                if (sz === '16') return true;
                // n-n.5 (vế sau đúng +0.5)
                const m = sz.match(/^([1-9]|1[0-5])\-([1-9]|1[0-5])(\.5)?$/);
                return !!(m && m[3] === '.5');
            }

            const allSizesValid = sizeList.length > 0 && sizeList.every(isValidSize);
            if (!allSizesValid) { showGlobalToast('Sai định dạng Size! Cho phép: n, n.5, n-n.5 (1–16; không có 16.5)', false); return; }

            const isValidMoldName = /^[A-Z]([0-9]{0,2})?$/.test(mold_name);
            if (!isValidMoldName) { showGlobalToast('Sai Mold Name! Cho phép: A, A1, B2, ... (1 chữ hoa + tối đa 2 số)', false); return; }

            const isValidYellowText = /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(yellowText);
            if (!isValidYellowText) { showGlobalToast('Sai Thời gian phun mực! Định dạng phải là MM-DD HH:MM:SS', false); return; }

            const isValidSide = side_lr === 'L' || side_lr === 'R';
            if (!isValidSide) { showGlobalToast('Vui lòng chọn Loại đế (Trái hoặc Phải)', false); return; }

            if (!employeeNo || !productionShift) {
                showGlobalToast('Thiếu Mã số thẻ hoặc Chuyền sản xuất!', false);
                return;
            }

            // --- 3) TẠO PAYLOAD & GỬI LÊN SERVER ---
            function nowISO() {
                const now = new Date();
                // VN UTC+7
                now.setHours(now.getHours() + 7);
                return now.toISOString();
            }
            function convertInkjetTime(val) {
                const y = new Date().getFullYear();
                const m = val.match(/^(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
                return m ? `${y}-${m[1]}-${m[2]}T${m[3]}` : '';
            }

            const payload = {
                user_id: employeeNo,
                scan_time: nowISO(),
                mold_id: mold_id,           // dòng 2
                tool_code: tool_code,       // dòng 3
                mold_size: sizeList,        // dòng 4
                mold_name: mold_name,       // dòng 5
                side_lr: side_lr,           // “Loại đế” L/R (từ data-side)
                inkjet_time: convertInkjetTime(yellowText),
                color_way: color_way,
                production_shift: productionShift,
                error_1, error_2, error_3
            };
            // console.log(payload);
            try {
                const res = await fetch('/insert-ocr-error', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    showGlobalToast('Lưu thành công', true);
                } else {
                    let msg = 'Lưu thất bại';
                    try { const data = await res.json(); if (data?.error) msg = data.error; } catch { }
                    showGlobalToast(msg, false);
                }
            } catch (e) {
                showGlobalToast('Lưu thất bại', false);
            }
        };

    }
});

// --- Employee No Dialog ---


function showEmployeeNoDialog() {
    const overlay = document.createElement('div');
    overlay.id = 'employee-no-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.18)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 100000;

    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.borderRadius = '14px';
    box.style.boxShadow = '0 2px 16px rgba(0,0,0,0.13)';
    box.style.padding = '28px 32px 22px 32px';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.minWidth = '320px';

    const label = document.createElement('div');
    label.style.fontWeight = '600';
    label.style.fontSize = '17px';
    label.style.marginBottom = '12px';
    label.textContent = 'Vui lòng nhập mã số thẻ';
    box.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Mã số thẻ';
    input.style.fontSize = '16px';
    input.style.padding = '8px 12px';
    input.style.borderRadius = '8px';
    input.style.border = '1.5px solid #e5e7eb';
    input.style.marginBottom = '18px';
    input.style.width = '100%';
    box.appendChild(input);

    // Label cho shift
    const shiftLabel = document.createElement('div');
    shiftLabel.textContent = 'Vui lòng chọn chuyền';
    shiftLabel.style.fontWeight = '600';
    shiftLabel.style.marginBottom = '8px';
    box.appendChild(shiftLabel);

    // Group 2 nút A / C
    const shiftGroup = document.createElement('div');
    shiftGroup.style.display = 'flex';
    shiftGroup.style.gap = '12px';
    shiftGroup.style.marginBottom = '18px';

    const shiftButtons = ['A', 'C'].map((shift) => {
        const btn = document.createElement('button');
        btn.textContent = shift;
        btn.dataset.shift = shift;
        btn.style.padding = '6px 20px';
        btn.style.borderRadius = '8px';
        btn.style.border = '1.5px solid #d1d5db';
        btn.style.background = '#f9fafb';
        btn.style.cursor = 'pointer';
        btn.onclick = () => {
            // Bỏ chọn các nút khác
            shiftButtons.forEach(b => {
                b.style.background = '#f9fafb';
                b.style.border = '1.5px solid #d1d5db';
            });
            // Chọn nút hiện tại
            btn.style.background = '#2563eb';
            btn.style.border = '1.5px solid #2563eb';
            btn.style.color = '#fff';
            selectedShift = shift;
        };
        return btn;
    });

    let selectedShift = '';

    shiftButtons.forEach(btn => shiftGroup.appendChild(btn));
    box.appendChild(shiftGroup);

    const btn = document.createElement('button');
    btn.textContent = 'Xác nhận';
    btn.style.background = '#2563eb';
    btn.style.color = '#fff';
    btn.style.fontWeight = '600';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.padding = '7px 22px';
    btn.style.fontSize = '15px';
    btn.style.cursor = 'pointer';
    box.appendChild(btn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();

    async function submitEmployeeNo() {
        const val = input.value.trim();
        if (!val) {
            input.style.border = '2px solid #ef4444';
            input.focus();
            return;
        }

        if (!selectedShift) {
            showGlobalToast('Please select your Production Shift (A or C).', false);
            return;
        }

        try {
            btn.disabled = true;
            input.disabled = true;

            const res = await fetch(`/check-employee-no?empno=${encodeURIComponent(val)}`);
            const data = await res.json();

            if (res.ok && data && data.allowed === true) {
                employeeNo = val;
                productionShift = selectedShift;
                document.body.removeChild(overlay);
            } else {
                input.style.border = '2px solid #ef4444';
                input.focus();
                showGlobalToast('You are not allowed to enter the system.', false);
                btn.disabled = false;
                input.disabled = false;
            }
        } catch (e) {
            input.style.border = '2px solid #ef4444';
            input.focus();
            showGlobalToast('You are not allowed to enter the system.', false);
            btn.disabled = false;
            input.disabled = false;
        }
        console.log('EmployeeNO: ' + employeeNo + ', Shift: ' + productionShift);
    }

    btn.onclick = submitEmployeeNo;
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitEmployeeNo();
    });

}


// --- Enhanced recommend dropdown for color-way-input ---
let colorWayArticlesCache = [];
let colorWayLastToolingCode = '';
let colorWayLastFetch = '';

function renderColorWaySuggestBox(input, articles, filterVal) {
    const suggestBox = document.getElementById('color-way-suggest');
    if (!suggestBox) return;
    // Filter articles by input value
    let filtered = articles;
    if (filterVal) {
        const val = filterVal.trim().toLowerCase();
        filtered = articles.filter(a => a.toLowerCase().includes(val));
    }
    if (filtered.length === 0) {
        suggestBox.innerHTML = '<div class="color-way-suggest-empty">No suggestions found</div>';
    } else {
        suggestBox.innerHTML = filtered.map(article =>
            `<div class="color-way-suggest-item">${article}</div>`
        ).join('');
    }
    suggestBox.style.display = 'block';

    // --- Position the suggest box as fixed, overlay above all panels ---
    const rect = input.getBoundingClientRect();
    suggestBox.style.position = 'fixed';
    suggestBox.style.left = rect.left + 'px';
    suggestBox.style.top = (rect.bottom + 2) + 'px';
    suggestBox.style.width = rect.width + 'px';
    suggestBox.style.maxWidth = rect.width + 'px';
    suggestBox.style.zIndex = 99999;
    suggestBox.style.minWidth = '220px';
    suggestBox.style.maxHeight = '420px';

    // Style for suggest box and items (ensure only one style tag)
    if (!document.getElementById('color-way-suggest-style')) {
        const style = document.createElement('style');
        style.id = 'color-way-suggest-style';
        style.textContent = `
            #color-way-suggest {
                font-family: 'Inter', Arial, sans-serif;
                background: #fff;
                border: 1.5px solid #2563eb;
                border-radius: 10px;
                box-shadow: 0 8px 32px rgba(37,99,235,0.18);
                margin-top: 0;
                padding: 0;
                overflow-y: auto;
                z-index: 99999;
            }
            .color-way-suggest-item {
                padding: 12px 18px;
                cursor: pointer;
                font-size: 17px;
                color: #2563eb;
                transition: background 0.13s, color 0.13s;
                border-bottom: 1px solid #e5e7eb;
                background: #fff;
            }
            .color-way-suggest-item:last-child {
                border-bottom: none;
            }
            .color-way-suggest-item:hover, .color-way-suggest-item.active {
                background: #e0e7ef;
                color: #ef4444;
            }
            .color-way-suggest-empty {
                padding: 12px 18px;
                color: #ef4444;
                font-size: 16px;
            }
        `;
        document.head.appendChild(style);
    }

    // Click to select
    suggestBox.querySelectorAll('.color-way-suggest-item').forEach(item => {
        item.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
            input.value = item.textContent;
            suggestBox.style.display = 'none';
            input.setAttribute('data-valid', '1');
        });
    });
}

// Fetch and show recommend on focus or input
async function handleColorWayInputRecommend(e) {
    const input = e.target;
    const suggestBox = document.getElementById('color-way-suggest');
    if (!suggestBox) return;

    // Get value of line 2, corrected (input in row 2, column "Corrected")
    let toolingCode = '';
    try {
        const ocrTable = input.closest('.ocr-table');
        if (ocrTable) {
            const row = ocrTable.querySelectorAll('tbody tr')[1];
            if (row) {
                const fixedInput = row.querySelector('.ocr-fixed input');
                if (fixedInput) toolingCode = fixedInput.value.trim();
            }
        }
    } catch (err) { }

    if (!toolingCode) {
        suggestBox.style.display = 'none';
        colorWayArticlesCache = [];
        colorWayLastToolingCode = '';
        return;
    }

    // Always fetch API on focus/input
    suggestBox.innerHTML = '<div class="color-way-suggest-item" style="color:#2563eb;">Loading...</div>';
    suggestBox.style.display = 'block';
    try {
        const res = await fetch('https://10.13.32.51:8443/proxy-getmold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tooling_code: toolingCode })
        });
        const data = await res.json();
        colorWayArticlesCache = Array.isArray(data.articles) ? data.articles : [];
        colorWayLastToolingCode = toolingCode;
    } catch (err) {
        colorWayArticlesCache = [];
        colorWayLastToolingCode = toolingCode;
    }
    // Always filter by input value
    renderColorWaySuggestBox(input, colorWayArticlesCache, input.value);
    // Mark as invalid until user selects
    input.setAttribute('data-valid', '0');
}

// Listen for focus and input events
document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'color-way-input') {
        handleColorWayInputRecommend(e);
    }
});
document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'color-way-input') {
        handleColorWayInputRecommend(e);
    }
});
document.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') {
        document.querySelector('.side-btn[data-side="L"]')?.click();
    } else if (event.key === 'ArrowRight') {
        document.querySelector('.side-btn[data-side="R"]')?.click();
    }
});

// Hide suggest box on blur (with delay to allow click)
document.addEventListener('focusout', function (e) {
    if (e.target && e.target.id === 'color-way-input') {
        const input = e.target;
        const suggestBox = document.getElementById('color-way-suggest');
        setTimeout(() => {
            if (suggestBox) suggestBox.style.display = 'none';
            // Only allow value in articles
            if (
                !colorWayArticlesCache.includes(input.value)
            ) {
                input.value = '';
                input.setAttribute('data-valid', '0');
            }
        }, 180);
    }
});

// Hide recommend if not focused (also if user clicks elsewhere)
document.addEventListener('mousedown', function (e) {
    const input = document.getElementById('color-way-input');
    const suggestBox = document.getElementById('color-way-suggest');
    if (!input || !suggestBox) return;
    // If click is outside input and suggestBox, hide suggestBox
    if (
        e.target !== input &&
        !suggestBox.contains(e.target)
    ) {
        suggestBox.style.display = 'none';
    }
});
///////////
// ===== Webcam Modal & Capture (full rewrite) =====
(() => {
    'use strict';

    // ---- Elements ----
    const webcamBtn = document.getElementById('webcam-btn');   // nút mở modal
    const webcamModal = document.getElementById('webcam-modal');
    const webcamClose = document.getElementById('webcam-close');
    const webcamVideo = document.getElementById('webcam-video');
    const webcamCanvas = document.getElementById('webcam-canvas');
    const webcamCaptureBtn = document.getElementById('webcam-capture');

    // ---- State ----
    let webcamStream = null;

    // ---- Helpers ----
    function setVideoRotationCCW90() {
        webcamVideo.style.transform = 'rotate(90deg)';
        webcamVideo.style.transformOrigin = 'center center';
        webcamVideo.style.objectFit = 'contain';
        webcamVideo.style.display = 'block';
    }

    function scaleForViewport(rotW, rotH) {
        // Giới hạn theo viewport của modal: 92vw x 82vh
        const maxW = Math.floor(window.innerWidth * 0.92);
        const maxH = Math.floor(window.innerHeight * 0.82);
        const scale = Math.min(maxW / rotW, maxH / rotH, 1); // không upscale
        return {
            outW: Math.max(1, Math.floor(rotW * scale)),
            outH: Math.max(1, Math.floor(rotH * scale)),
        };
    }

    function fitWebcamPreview() {
        if (!webcamVideo || !webcamVideo.videoWidth || !webcamVideo.videoHeight) return;

        const vw = webcamVideo.videoWidth;
        const vh = webcamVideo.videoHeight;

        // sau xoay -90°: width = vh, height = vw
        const rotW = vh;
        const rotH = vw;

        const { outW, outH } = scaleForViewport(rotW, rotH);

        const box = webcamVideo.parentElement; // .webcam-box
        if (box) {
            box.style.width = outW + 'px';
            box.style.height = outH + 'px';
        }

        // Width/height phần tử video (trước xoay) phải hoán đổi để khớp khung sau xoay
        webcamVideo.style.width = outH + 'px';
        webcamVideo.style.height = outW + 'px';
    }

    async function startWebcam() {
        stopWebcam();
        try {
            const constraints = {
                audio: false,
                video: {
                    width: { ideal: 9999 },
                    height: { ideal: 9999 },
                    facingMode: 'environment'
                }
            };

            webcamStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Cố gắng đẩy lên max capabilities nếu hỗ trợ
            try {
                const track = webcamStream.getVideoTracks()[0];
                const caps = track.getCapabilities && track.getCapabilities();
                if (caps && caps.width && caps.height) {
                    await track.applyConstraints({ width: caps.width.max, height: caps.height.max });
                }
            } catch (_) { }

            webcamVideo.srcObject = webcamStream;
            setVideoRotationCCW90();

            try { await webcamVideo.play(); } catch (_) { }
            if (webcamVideo.readyState >= 2) {
                fitWebcamPreview();
            } else {
                webcamVideo.addEventListener('loadedmetadata', fitWebcamPreview, { once: true });
            }
        } catch (err) {
            console.error('Webcam error:', err);
            alert(`Không mở được webcam: ${err?.message || err}`);
            closeWebcamModal();
        }
    }

    function stopWebcam() {
        try {
            if (webcamStream) webcamStream.getTracks().forEach(t => t.stop());
        } catch (_) { }
        webcamStream = null;
        if (webcamVideo) webcamVideo.srcObject = null;
    }

    function openWebcamModal() {
        if (!webcamModal) return;
        webcamModal.classList.remove('hidden');
        webcamModal.setAttribute('aria-hidden', 'false');
        startWebcam();
    }

    function closeWebcamModal() {
        stopWebcam();
        if (!webcamModal) return;
        webcamModal.classList.add('hidden');
        webcamModal.setAttribute('aria-hidden', 'true');
    }

    // === Capture: vẽ lên canvas (resize) + tiếp tục flow cũ ===
    async function captureFromWebcam() {
        if (!webcamVideo || !webcamVideo.videoWidth || !webcamVideo.videoHeight) return;

        const vw = webcamVideo.videoWidth;
        const vh = webcamVideo.videoHeight;

        // Xuất ảnh đã XOAY -90° CCW (nên output width = vh, height = vw)
        webcamCanvas.width = vh;
        webcamCanvas.height = vw;

        const wctx = webcamCanvas.getContext('2d');
        wctx.save();
        wctx.translate(webcamCanvas.width, 0);
        wctx.rotate(Math.PI / 2);
        wctx.drawImage(webcamVideo, 0, 0, vw, vh);
        wctx.restore();

        webcamCanvas.toBlob(async (blob) => {
            if (!blob) return;

            // 1) Hiển thị BẢN RESIZE trên #roi-canvas (flow cũ dùng maxW=600, maxH=800)
            try {
                const url = URL.createObjectURL(blob);
                const previewImg = new Image();
                previewImg.onload = function () {
                    // Cập nhật biến global để draw() dùng
                    // (các biến/func này có sẵn trong script cũ)
                    // img, imgNaturalWidth, imgNaturalHeight, scale, canvas, ctx, imgSizeDiv, draw()
                    window.img = previewImg;
                    window.imgNaturalWidth = previewImg.naturalWidth;
                    window.imgNaturalHeight = previewImg.naturalHeight;

                    if (window.imgSizeDiv) {
                        window.imgSizeDiv.textContent = `Kích thước ảnh gốc: ${window.imgNaturalWidth} × ${window.imgNaturalHeight} pixels`;
                    }

                    const maxW = 600, maxH = 800;
                    window.scale = Math.min(maxW / window.imgNaturalWidth, maxH / window.imgNaturalHeight, 1);

                    // #roi-canvas có biến global 'canvas'
                    if (window.canvas) {
                        window.canvas.width = Math.round(window.imgNaturalWidth * window.scale);
                        window.canvas.height = Math.round(window.imgNaturalHeight * window.scale);
                    }

                    if (typeof window.draw === 'function') window.draw();

                    // Không cần giữ URL lâu
                    URL.revokeObjectURL(url);
                };
                previewImg.src = url;
            } catch (e) {
                console.warn('Preview-to-canvas failed:', e);
            }

            // 2) Tiếp tục FLOW CŨ: ưu tiên handleFile(file), fallback handleFiles([file])
            const file = new File([blob], `webcam_${Date.now()}.png`, { type: 'image/png' });
            try {
                if (typeof window.handleFile === 'function') {
                    await window.handleFile(file);
                } else if (typeof window.handleFiles === 'function') {
                    await window.handleFiles([file]); // handleFiles dùng files[0]; array vẫn ổn
                }
                // --- Auto click "yellow text" button same as socket flow ---
                setTimeout(() => {
                    const btns = document.querySelectorAll('.color-btn');
                    for (const btn of btns) {
                        const desc = (btn.getAttribute('data-desc') || '').trim().toLowerCase();
                        if (desc === 'yellow text') {
                            btn.click();
                            break;
                        }
                    }
                }, 300);
            } catch (e) {
                console.error('Flow error:', e);
            }

            // 3) Đóng modal
            //   closeWebcamModal();
        }, 'image/png');
    }

    // ---- Events ----
    webcamBtn && webcamBtn.addEventListener('click', openWebcamModal);
    webcamClose && webcamClose.addEventListener('click', closeWebcamModal);

    // Click backdrop để đóng
    webcamModal && webcamModal.addEventListener('click', (e) => {
        if (e.target && (e.target.classList?.contains('modal-backdrop') || e.target.getAttribute('data-close') === 'modal')) {
            closeWebcamModal();
        }
    });

    // ESC để đóng
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && webcamModal && !webcamModal.classList.contains('hidden')) {
            closeWebcamModal();
        }
    });

    // Capture
    webcamCaptureBtn && webcamCaptureBtn.addEventListener('click', captureFromWebcam);

    // Fit lại khi resize
    window.addEventListener('resize', fitWebcamPreview);

    // Cleanup khi rời trang
    window.addEventListener('beforeunload', stopWebcam);
    window.startWebcam = startWebcam;
})();




const dropArea = document.getElementById('drop-area');
const fileElem = document.getElementById('fileElem');
const canvas = document.getElementById('roi-canvas');
const ctx = canvas.getContext('2d');
const captureBtn = document.getElementById('capture-btn');
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

document.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
});
document.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
});

// dropArea.addEventListener('dragover', function (e) {
//     e.preventDefault();
//     e.stopPropagation();
//     dropArea.style.background = '#e0e7ef';
// });
// dropArea.addEventListener('dragleave', function (e) {
//     e.preventDefault();
//     e.stopPropagation();
//     dropArea.style.background = '';
// });
// dropArea.addEventListener('drop', function (e) {
//     e.preventDefault();
//     e.stopPropagation();
//     dropArea.style.background = '';
//     handleFiles(e.dataTransfer.files);
// });

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
dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.style.background = '#e0e7ef'; });
dropArea.addEventListener('dragleave', e => { e.preventDefault(); dropArea.style.background = ''; });
dropArea.addEventListener('drop', e => {
    e.preventDefault();
    dropArea.style.background = '';
    handleFiles(e.dataTransfer.files);
});
fileElem.addEventListener('change', e => handleFiles(e.target.files));

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
                imgSizeDiv.textContent = `Original image size: ${imgNaturalWidth} × ${imgNaturalHeight} pixels`;
                // Tính scale giữa canvas và ảnh gốc
                let maxW = 600, maxH = 800;
                scale = Math.min(maxW / imgNaturalWidth, maxH / imgNaturalHeight, 1);
                canvas.width = Math.round(imgNaturalWidth * scale);
                canvas.height = Math.round(imgNaturalHeight * scale);
                // Load cả 2 ROI (main và sideDetectRoi)
                loadRoiFromServer(() => {
                    loadSideDetectRoiFromTxt(draw);
                });
                // --- TỰ ĐỘNG CHỤP ẢNH SAU KHI LOAD ẢNH XONG ---
                setTimeout(() => {
                    captureBtn.click();
                }, 200); // delay nhỏ để đảm bảo ảnh đã vẽ xong
            };
            img.src = URL.createObjectURL(file);
        })
        .catch(err => {
            // Error already handled above, do not reload page
        });
}

function saveRoiToServer() {
    fetch('/roi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roi)
    });
}

// ROI mouse events (only when img loaded and roiEditable)
canvas.addEventListener('mousedown', e => {
    if (!img || !roiEditable) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const handleIdx = getHandleAt(x, y);
    if (handleIdx !== -1) {
        resizing = true;
        resizeCorner = handleIdx;
    } else if (x > roi.x && x < roi.x + roi.w && y > roi.y && y < roi.y + roi.h) {
        dragging = true;
        dragOffset = { x: x - roi.x, y: y - roi.y };
    }
});

canvas.addEventListener('mousemove', e => {
    if (!img || !roiEditable) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (resizing) {
        switch (resizeCorner) {
            case 0: // top-left
                roi.w += roi.x - x;
                roi.h += roi.y - y;
                roi.x = x;
                roi.y = y;
                break;
            case 1: // top-right
                roi.w = x - roi.x;
                roi.h += roi.y - y;
                roi.y = y;
                break;
            case 2: // bottom-left
                roi.w += roi.x - x;
                roi.x = x;
                roi.h = y - roi.y;
                break;
            case 3: // bottom-right
                roi.w = x - roi.x;
                roi.h = y - roi.y;
                break;
        }
        roi.w = Math.max(30, Math.min(roi.w, canvas.width - roi.x));
        roi.h = Math.max(30, Math.min(roi.h, canvas.height - roi.y));
        roi.x = Math.max(0, Math.min(roi.x, canvas.width - 30));
        roi.y = Math.max(0, Math.min(roi.y, canvas.height - 30));
        draw();
    } else if (dragging) {
        roi.x = Math.max(0, Math.min(x - dragOffset.x, canvas.width - roi.w));
        roi.y = Math.max(0, Math.min(y - dragOffset.y, canvas.height - roi.h));
        draw();
    }
});

canvas.addEventListener('mouseup', e => {
    dragging = false;
    resizing = false;
    resizeCorner = null;
});
canvas.addEventListener('mouseleave', e => {
    dragging = false;
    resizing = false;
    resizeCorner = null;
});

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

// Thêm panel kết quả OCR dưới right-panel
// Đã có sẵn #ocrResultsContainer trong right-panel

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
            const promptRes = await fetch('/static/prompt.txt');
            const prompt = await promptRes.text();

            const response = await fetch('http://10.13.33.50:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2.5vl:latest',
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
                ocrArr[3] || '',
                ocrArr[4] || '',
                ocrArr[5] || ''
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

                // Tìm tất cả các chuỗi dạng số hoặc số có dấu gạch ngang giữa các chữ cái
                // VD: MS95WS11, MS5555WS11, MS11-115WS11, MS8WS115
                // => Tìm tất cả các số hoặc số có dấu gạch ngang nằm giữa các chữ cái
                let result = compactVal;
                let changed = false;

                // Xử lý các cụm số hoặc số có dấu gạch ngang giữa các chữ cái
                result = result.replace(/([A-Za-z]+)(\d+(?:-\d+)?)(?=[A-Za-z]|$)/g, function (_, prefix, num) {
                    // --- Thêm xử lý đặc biệt cho num == 111 ---
                    if (num === "111") {
                        changed = true;
                        return prefix + "11";
                    }
                    // Trường hợp đặc biệt: 15 và 1.5 đều có trong dictionary
                    if (
                        (num === "15" || num === "1.5") &&
                        dictionary.includes("15") && dictionary.includes("1.5")
                    ) {
                        changed = true;
                        // Trả về cả hai giá trị, nhưng chỉ dùng cho trường hợp không có hậu tố phía sau
                        // Nếu có hậu tố phía sau, chỉ trả về một giá trị
                        return `${prefix}15`; // sẽ xử lý trả về mảng ở ngoài
                    }

                    // Nếu là số có dấu gạch ngang, ví dụ 11-115
                    if (/^\d+-\d+$/.test(num)) {
                        if (dictionary.includes(num)) {
                            changed = true;
                            return prefix + num;
                        }
                        // Thử chèn dấu chấm vào phần sau dấu gạch
                        let [left, right] = num.split('-');
                        for (let i = 1; i < right.length; ++i) {
                            let candidate = left + '-' + right.slice(0, i) + '.' + right.slice(i);
                            if (dictionary.includes(candidate)) {
                                changed = true;
                                return prefix + candidate;
                            }
                        }
                        // Không sửa được, giữ nguyên
                        return prefix + num;
                    }

                    // Nếu là số bình thường, thử chèn dấu chấm vào mọi vị trí
                    if (dictionary.includes(num)) {
                        return prefix + num;
                    }
                    for (let i = 1; i < num.length; ++i) {
                        let candidate = num.slice(0, i) + '.' + num.slice(i);
                        if (dictionary.includes(candidate)) {
                            changed = true;
                            return prefix + candidate;
                        }
                    }
                    // Không sửa được, giữ nguyên
                    return prefix + num;
                });

                // Trường hợp đặc biệt: 15 và 1.5 đều có trong dictionary, trả về cả hai giá trị
                if (
                    /([A-Za-z]+)15([A-ZaZ]*)$/.test(compactVal) &&
                    dictionary.includes("15") && dictionary.includes("1.5")
                ) {
                    let prefix = compactVal.match(/([A-Za-z]+)15([A-ZaZ]*)$/)[1];
                    let suffix = compactVal.match(/([A-Za-z]+)15([A-ZaZ]*)$/)[2];
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
                    // Chỉ sửa part1 (row 4, idx==3)
                    if (idx === 3) return fixPart1(val);
                    return correctByDictionary(val);
                }
                return val;
            });

            // --- LOG THÔNG TIN ĐÃ SỬA ĐỂ XỬ LÍ LINE 1 ---
            // fixedArr[1] là mold_id đã sửa (line2)
            // fixedArr[3] là part1 đã sửa (size, có thể là mảng)
            // fixedArr[4] là part2 đã sửa (shift, có thể là mảng)
            let mold_id = Array.isArray(fixedArr[1]) ? fixedArr[1][0] : fixedArr[1];

            // Lấy tất cả giá trị size đã sửa từ các input trong cột "Đã sửa" (ocr-cell ocr-fixed) của hàng part1 (STT 4)
            setTimeout(() => {
                const ocrTable = document.querySelector('.ocr-table');
                if (ocrTable) {
                    // Hàng STT 4 là tr:nth-child(4)
                    const row = ocrTable.querySelector('tr:nth-child(4) .ocr-cell.ocr-fixed');
                    if (row) {
                        const inputs = row.querySelectorAll('input');
                        // Lấy ra các giá trị số hoặc số có dấu gạch giữa MS và WS (hoặc MS và hết chuỗi nếu không có WS)
                        let sizeList = Array.from(inputs).map(input => {
                            const val = input.value || '';
                            // Ưu tiên lấy chuỗi dạng số hoặc số có dấu gạch sau MS, trước WS (nếu có)
                            // VD: MS11-11.5WS11 => lấy 11-11.5, MS11-11.5 => lấy 11-11.5
                            let match = val.match(/MS\s*([0-9.\-]+)(?=WS|$)/i);
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
                                    let allNums = val.match(/[0-9.\-]+/g);
                                    if (allNums) {
                                        let found = allNums.find(x => {
                                            // Nếu là dạng 11-11.5 thì không parseFloat, giữ nguyên
                                            if (/^\d+-\d+(\.\d+)?$/.test(x)) return true;
                                            return parseFloat(x) <= 16;
                                        });
                                        if (found) num = found;
                                    }
                                }
                            }
                            return num;
                        }).filter(Boolean);
                        let shift = Array.isArray(fixedArr[4]) ? fixedArr[4][0] : fixedArr[4];

                        // --- LẤY GIÁ TRỊ SIDE TỪ DÒNG "SIDE" CỘT "ĐÃ SỬA" ---
                        let side = '';
                        // Dòng cuối cùng là dòng "Side", cột "Đã sửa"
                        const sideRow = ocrTable.querySelector(`tr:nth-child(${displayArr.length + 1}) .ocr-cell.ocr-fixed input`);
                        if (sideRow) {
                            side = sideRow.value || '';
                        }

                        // Log dữ liệu trước khi gửi lên API
                        console.log('fetch-moldip-for-line1 payload:', {
                            mold_id: mold_id,
                            size: sizeList,
                            shift: shift,
                            side: side // thêm trường side
                        });

                        // Gửi dữ liệu lên endpoint /fetch-moldip-for-line1
                        fetch('/fetch-moldip-for-line1', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                mold_id: mold_id,
                                size: sizeList, // truyền mảng size
                                shift: shift,
                                side: side // truyền thêm side
                            })
                        })
                            .then(res => res.json())
                            .then(data => {
                                // Log response data sau khi fetch-moldip-for-line1
                                console.log('fetch-moldip-for-line1 response:', data);
                                // --- SỬA LINE 1 TỪ DICTIONARY TRẢ VỀ ---
                                if (data && Array.isArray(data.mold_ip_list) && data.mold_ip_list.length > 0) {
                                    // Lấy input của dòng 1, cột "Đã sửa" (STT 1, index 0)
                                    const line1Row = ocrTable.querySelector('tr:nth-child(1) .ocr-cell.ocr-fixed input');
                                    if (line1Row) {
                                        // Tìm giá trị gần đúng nhất trong mold_ip_list cho dòng 1 gốc
                                        const line1OriginInput = ocrTable.querySelector('tr:nth-child(1) .ocr-cell.ocr-origin input');
                                        let line1Origin = line1OriginInput ? line1OriginInput.value : '';
                                        // Hàm tìm gần đúng nhất (Levenshtein)
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
                                        let best = data.mold_ip_list[0];
                                        let minDist = levenshtein(line1Origin, best);
                                        for (const cand of data.mold_ip_list) {
                                            const dist = levenshtein(line1Origin, cand);
                                            if (dist < minDist) {
                                                minDist = dist;
                                                best = cand;
                                            }
                                        }
                                        // Gán giá trị tốt nhất vào input "Đã sửa" dòng 1
                                        line1Row.value = best;
                                        line1Row.classList.add('fixed');
                                    }
                                }
                            })
                            .catch(err => {
                                console.error('fetch-moldip-for-line1 error:', err);
                            });
                    }
                }
            }, 0);

            // Render bảng OCR
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
                if (i === 0 || i === 1 || i === 3 || i === 4) {
                    html += `<td>
              <div class="ocr-cell ocr-fixed">`;
                    if (Array.isArray(fixedArr[i])) {
                        for (const fixedVal of fixedArr[i]) {
                            html += `<input type="text" value="${fixedVal}" readonly class="fixed multi">`;
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
            // --- Thêm dòng hiển thị kết quả side ---
            html += `<tr>
                <td class="stt">${displayArr.length + 1}</td>
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
            </tr>`;
            // --- Thêm dòng số 10: Yellow Text ---
            html += `<tr>
                <td class="stt">10</td>
                <td>
                    <div class="ocr-cell ocr-origin">
                        <input type="text" value="Yellow Text" readonly>
                    </div>
                </td>
                <td>
                    <div class="ocr-cell ocr-fixed">
                        <input type="text" value="${lastYellowText !== null ? lastYellowText : ''}" readonly class="fixed">
                    </div>
                </td>
            </tr>`;
            html += `</tbody></table></div>
    <style>
    .ocr-result-wrapper {
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        margin-bottom: 10px;
    }
    .ocr-table {
        border-radius: 16px;
        overflow: hidden;
        background: #f8fafc;
        box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        margin: 0 auto;
    }
    .ocr-table th, .ocr-table td {
        padding: 0;
        border: none;
        background: none;
    }
    .ocr-th-stt {
        width: 44px;
        background: #e0e7ef;
        color: #2563eb;
        font-weight: 700;
        font-size: 16px;
        border-radius: 12px 0 0 0;
    }
    .ocr-th-origin {
        background: #e0e7ef;
        color: #2563eb;
        font-weight: 700;
        font-size: 16px;
    }
    .ocr-th-fixed {
        background: #fff0f0;
        color: #ef4444;
        font-weight: 700;
        font-size: 16px;
        border-radius: 0 12px 0 0;
    }
    .ocr-cell {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 10px 8px;
        justify-content: flex-start;
        align-items: center;
        min-height: 44px;
    }
    .ocr-origin input {
        width: 100%;
        min-width: 120px;
        max-width: 220px;
        font-size: 17px;
        padding: 7px 12px;
        border-radius: 8px;
        border: 1.5px solid #e5e7eb;
        background: #f8fafc;
        color: #222;
        font-weight: 500;
        box-shadow: 0 1px 4px rgba(100,116,139,0.04);
    }
    .ocr-fixed input.fixed {
        min-width: 80px;
        max-width: 120px;
        font-size: 16px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 2px solid #ef4444;
        background: #fff7f7;
        color: #ef4444;
        font-weight: 600;
        margin-bottom: 4px;
        margin-right: 6px;
        box-shadow: 0 1px 4px rgba(239,68,68,0.07);
        transition: border 0.2s;
    }
    .ocr-fixed input.fixed:focus {
        border: 2px solid #2563eb;
        outline: none;
    }
    .ocr-table tr {
        background: none;
    }
    .ocr-table tr:nth-child(even) .ocr-origin input,
    .ocr-table tr:nth-child(even) .ocr-fixed input.fixed {
        background: #f1f5f9;
    }
    .ocr-table tr:last-child td {
        border-radius: 0 0 12px 12px;
    }
    </style>
    `;
            container.innerHTML = html;
        } else {
            // Nếu không có kết quả OCR JSON hợp lệ, hiển thị bảng chỉ có dòng Side
            container.innerHTML = `
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
                <style>
                .ocr-result-wrapper {
                    width: 100%;
                    display: flex;
                    justify-content: center;
                    align-items: flex-start;
                    margin-bottom: 10px;
                }
                .ocr-table {
                    border-radius: 16px;
                    overflow: hidden;
                    background: #f8fafc;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
                    margin: 0 auto;
                }
                .ocr-table th, .ocr-table td {
                    padding: 0;
                    border: none;
                    background: none;
                }
                .ocr-th-stt {
                    width: 44px;
                    background: #e0e7ef;
                    color: #2563eb;
                    font-weight: 700;
                    font-size: 16px;
                    border-radius: 12px 0 0 0;
                }
                .ocr-th-origin {
                    background: #e0e7ef;
                    color: #2563eb;
                    font-weight: 700;
                    font-size: 16px;
                }
                .ocr-th-fixed {
                    background: #fff0f0;
                    color: #ef4444;
                    font-weight: 700;
                    font-size: 16px;
                    border-radius: 0 12px 0 0;
                }
                .ocr-cell {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    padding: 10px 8px;
                    justify-content: flex-start;
                    align-items: center;
                    min-height: 44px;
                }
                .ocr-origin input {
                    width: 100%;
                    min-width: 120px;
                    max-width: 220px;
                    font-size: 17px;
                    padding: 7px 12px;
                    border-radius: 8px;
                    border: 1.5px solid #e5e7eb;
                    background: #f8fafc;
                    color: #222;
                    font-weight: 500;
                    box-shadow: 0 1px 4px rgba(100,116,139,0.04);
                }
                .ocr-fixed input.fixed {
                    min-width: 80px;
                    max-width: 120px;
                    font-size: 16px;
                    padding: 6px 10px;
                    border-radius: 8px;
                    border: 2px solid #ef4444;
                    background: #fff7f7;
                    color: #ef4444;
                    font-weight: 600;
                    margin-bottom: 4px;
                    margin-right: 6px;
                    box-shadow: 0 1px 4px rgba(239,68,68,0.07);
                    transition: border 0.2s;
                }
                .ocr-fixed input.fixed:focus {
                    border: 2px solid #2563eb;
                    outline: none;
                }
                .ocr-table tr {
                    background: none;
                }
                .ocr-table tr:nth-child(even) .ocr-origin input,
                .ocr-table tr:nth-child(even) .ocr-fixed input.fixed {
                    background: #f1f5f9;
                }
                .ocr-table tr:last-child td {
                    border-radius: 0 0 12px 12px;
                }
                </style>
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

// Hàm kiểm tra ROI hiện tại có ký tự dập nổi không (gọi olama)
async function visibleText(blob) {
    // Gửi ảnh lên API Flask để nhận diện text
    const formData = new FormData();
    formData.append('image', blob, 'roi.png');
    formData.append('question', 'Transcribe the text');
    try {
        const response = await fetch('http://10.13.33.50:5000/query?stream=false', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        // data.answer là chuỗi trả về
        if (data && typeof data.answer === 'string') {
            return data.answer.length > 10;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Sau khi nhận ảnh crop từ API Python, gọi hàm này để OCR
function handleCropAndOCR(blob) {
    // Show cropped image larger
    resultDiv.innerHTML = '';
    const croppedImg = new Image();
    croppedImg.src = URL.createObjectURL(blob);
    croppedImg.style.maxWidth = '98%';
    croppedImg.style.maxHeight = '600px';
    croppedImg.style.width = 'auto';
    croppedImg.style.height = 'auto';
    croppedImg.style.borderRadius = '12px';
    croppedImg.style.boxShadow = '0 2px 12px rgba(34,197,94,0.09)';
    resultDiv.appendChild(croppedImg);

    // Kiểm tra có ký tự dập nổi không
    visibleText(blob).then(hasText => {
        if (hasText) {
            // Có ký tự, xử lý OCR như cũ
            processCombinedOCR(blob);
        } else {
            // Không có ký tự, render bảng với các dòng là N/A
            const container = document.getElementById('ocrResultsContainer');
            const ocrPanel = document.getElementById('right-panel');
            // 6 dòng N/A + dòng Side (nếu có)
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
                <tbody>`;
            for (let i = 0; i < 6; ++i) {
                html += `<tr>
                    <td class="stt">${i + 1}</td>
                    <td>
                      <div class="ocr-cell ocr-origin">
                        <input type="text" value="N/A" readonly>
                      </div>
                    </td>
                    <td>
                      <div class="ocr-cell ocr-fixed">
                        <input type="text" value="N/A" readonly class="fixed">
                      </div>
                    </td>
                  </tr>`;
            }
            // Dòng Side
            html += `<tr>
                <td class="stt">7</td>
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
            </tr>`;
            html += `</tbody></table></div>
            <style>
            .ocr-result-wrapper {
                width: 100%;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                margin-bottom: 10px;
            }
            .ocr-table {
                border-radius: 16px;
                overflow: hidden;
                background: #f8fafc;
                box-shadow: 0 2px 12px rgba(0,0,0,0.06);
                margin: 0 auto;
            }
            .ocr-table th, .ocr-table td {
                padding: 0;
                border: none;
                background: none;
            }
            .ocr-th-stt {
                width: 44px;
                background: #e0e7ef;
                color: #2563eb;
                font-weight: 700;
                font-size: 16px;
                border-radius: 12px 0 0 0;
            }
            .ocr-th-origin {
                background: #e0e7ef;
                color: #2563eb;
                font-weight: 700;
                font-size: 16px;
            }
            .ocr-th-fixed {
                background: #fff0f0;
                color: #ef4444;
                font-weight: 700;
                font-size: 16px;
                border-radius: 0 12px 0 0;
            }
            .ocr-cell {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                padding: 10px 8px;
                justify-content: flex-start;
                align-items: center;
                min-height: 44px;
            }
            .ocr-origin input {
                width: 100%;
                min-width: 120px;
                max-width: 220px;
                font-size: 17px;
                padding: 7px 12px;
                border-radius: 8px;
                border: 1.5px solid #e5e7eb;
                background: #f8fafc;
                color: #222;
                font-weight: 500;
                box-shadow: 0 1px 4px rgba(100,116,139,0.04);
            }
            .ocr-fixed input.fixed {
                min-width: 80px;
                max-width: 120px;
                font-size: 16px;
                padding: 6px 10px;
                border-radius: 8px;
                border: 2px solid #ef4444;
                background: #fff7f7;
                color: #ef4444;
                font-weight: 600;
                margin-bottom: 4px;
                margin-right: 6px;
                box-shadow: 0 1px 4px rgba(239,68,68,0.07);
                transition: border 0.2s;
            }
            .ocr-fixed input.fixed:focus {
                border: 2px solid #2563eb;
                outline: none;
            }
            .ocr-table tr {
                background: none;
            }
            .ocr-table tr:nth-child(even) .ocr-origin input,
            .ocr-table tr:nth-child(even) .ocr-fixed input.fixed {
                background: #f1f5f9;
            }
            .ocr-table tr:last-child td {
                border-radius: 0 0 12px 12px;
            }
            </style>
            `;
            container.innerHTML = html;
            if (ocrPanel) ocrPanel.style.display = 'flex';
        }
    });
}

// --- Hàm crop ảnh từ ROI bất kỳ, trả về blob ---
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
captureBtn.addEventListener('click', async () => {
    if (!img || !uploadedFilename || !uploadedFileHex) {
        resultDiv.innerHTML = '<span style="color:#ef4444;font-size:16px;">No image to crop!</span>';
        return;
    }
    // --- OCR LOADING EFFECT ---
    const ocrContainer = document.getElementById('ocrResultsContainer');
    if (ocrContainer) {
        ocrContainer.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:180px;">
                    <div class="ocr-loading-spinner"></div>
                    <div style="margin-top:12px;color:#2563eb;font-size:17px;font-weight:500;">Recognizing OCR...</div>
                </div>
                <style>
                .ocr-loading-spinner {
                    border: 5px solid #e0e7ef;
                    border-top: 5px solid #2563eb;
                    border-radius: 50%;
                    width: 44px;
                    height: 44px;
                    animation: ocr-spin 1s linear infinite;
                }
                @keyframes ocr-spin {
                    0% { transform: rotate(0deg);}
                    100% { transform: rotate(360deg);}
                }
                </style>
                `;
    }

    // --- Crop ảnh phụ (sideDetectRoi) và gửi lên /leftRightDetection trước ---
    const sideBlob = await cropImageFromRoi(sideDetectRoi);
    let sidePromise = Promise.resolve();
    if (sideBlob) {
        // Hiển thị ảnh đã cắt từ sideDetectRoi lên html (thêm vào dưới resultDiv)
        let sideImg = document.getElementById('side-cropped-img');
        if (!sideImg) {
            sideImg = document.createElement('img');
            sideImg.id = 'side-cropped-img';
            sideImg.style.maxWidth = '98%';
            sideImg.style.maxHeight = '300px';
            sideImg.style.width = 'auto';
            sideImg.style.height = 'auto';
            sideImg.style.borderRadius = '12px';
            sideImg.style.boxShadow = '0 2px 12px rgba(251,146,60,0.13)';
            resultDiv.parentNode.insertBefore(sideImg, resultDiv.nextSibling);
        }
        sideImg.src = URL.createObjectURL(sideBlob);

        // Gửi lên API leftRightDetection, đợi kết quả xong mới tiếp tục
        const formData = new FormData();
        formData.append('image', sideBlob, 'side.png');
        sidePromise = fetch('/leftRightDetection', {
            method: 'POST',
            body: formData
        })
            .then(res => res.json())
            .then(data => {
                console.log('leftRightDetection response:', data);
                lastSideResult = (data && data.side) ? data.side : null;

                // --- XỬ LÝ ROI_BASE64 VÀ TEXT ---
                // Hiển thị ảnh yellow text vào center-panel nếu có roi_base64
                lastYellowText = null;
                lastYellowImgUrl = null;
                if (data && data.roi_base64) {
                    // Tạo ảnh từ base64
                    const yellowImg = document.createElement('img');
                    yellowImg.style.maxWidth = '98%';
                    yellowImg.style.maxHeight = '120px';
                    yellowImg.style.width = 'auto';
                    yellowImg.style.height = 'auto';
                    yellowImg.style.borderRadius = '10px';
                    yellowImg.style.marginTop = '10px';
                    yellowImg.style.boxShadow = '0 2px 12px rgba(251,146,60,0.13)';
                    yellowImg.src = 'data:image/png;base64,' + data.roi_base64;
                    // Xóa ảnh cũ nếu có
                    if (lastYellowImgUrl) URL.revokeObjectURL(lastYellowImgUrl);
                    // Thêm vào yellow-text-img-container (trên Instructions)
                    const yellowImgContainer = document.getElementById('yellow-text-img-container');
                    // Xóa ảnh yellow text cũ nếu có
                    let old = document.getElementById('yellow-text-img');
                    if (old) old.remove();
                    yellowImg.id = 'yellow-text-img';
                    yellowImgContainer.appendChild(yellowImg);
                    lastYellowImgUrl = yellowImg.src;
                }
                // Lưu text (lấy đúng 10 ký tự từ phải sang trái)
                if (data && typeof data.text === 'string') {
                    let t = data.text.trim();
                    if (t.length > 10) t = t.slice(-10);
                    // Format nếu là 10 số: MMDDHHMMSS -> MM-DD HH:MM:SS
                    if (/^\d{10}$/.test(t)) {
                        t = `${t.slice(0,2)}-${t.slice(2,4)} ${t.slice(4,6)}:${t.slice(6,8)}:${t.slice(8,10)}`;
                    }
                    lastYellowText = t;
                } else {
                    lastYellowText = null;
                }
            })
            .catch(err => {
                console.error('leftRightDetection error:', err);
                lastSideResult = null;
                lastYellowText = null;
            });
    }

    // --- Đợi sidePromise xong mới crop ảnh chính và gọi handleCropAndOCR ---
    sidePromise.then(async () => {
        // --- Crop ảnh chính (roi) và gửi lên /crop ---
        fetch('/crop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: uploadedFilename,
                filedata: uploadedFileHex,
                roi: {
                    x: roi.x,
                    y: roi.y,
                    w: roi.w,
                    h: roi.h
                },
                scale: scale
            })
        })
            .then(res => {
                if (!res.ok) {
                    res.json().then(data => {
                        resultDiv.innerHTML = `<span style="color:#ef4444;font-size:16px;">Crop lỗi: ${data.error}</span>`;
                    });
                    return;
                }
                return res.blob();
            })
            .then(async blob => {
                if (!blob) return;
                await handleCropAndOCR(blob);
            });
    });
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

// Ví dụ: sử dụng ensureDictionaryReady() trước khi thao tác với dictionary
// if (!ensureDictionaryReady()) return;

// Initial draw
draw();

// Fetch dictionary on page load
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fetch-dict-btn').click();
});
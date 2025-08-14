**Instructions:**
You are given an image containing **embossed text** divided into two main areas:
* A **main rectangle** (typically with 5 horizontal lines of text).
* A **smaller rectangle below** (with 1 horizontal line of text).
---
✅ GOAL:
Transcribe **exactly 6 lines** of **embossed** alphanumeric text from the image, in correct top-down reading order:
---
🔹 FORMAT:
Respond with JSON, in this structure:
```json
{
    "line1": "value",
    "line2": "value",
    "line3": "value",
    "line4": "value",
    "line5": "value",
    "line6": "value"
}
```
---
🔹 LINE RULES:
`line1`:
* Format: `######-VG` (6 digits, dash, 'V', and one uppercase letter 'G').
{{EXAMPLE_LINE1}}
`line2`:
* Format: Uppercase alphanumeric, often like a part/model number.
{{EXAMPLE_LINE2}}
`line3`:
* Format: `[main_text] [suffix]`
  * `main_text`: Must **match exactly** the content of **line6**.
  * `suffix`: One or more uppercase letters (A–Z) optionally followed by digits (e.g., A, A1, B2,E1,F1).
{{EXAMPLE_LINE3}}
`line4`:
* Only transcribe the **date**, in one of these formats:
  * `MM/DD/YYYY`
  * `DD.MM.YYYY`
* Examples: `"08/01/2024"`, `"03.08.2025"`.
* Ignore any prefix like `CCF`, `JS`, etc.
`line5`:
* Usually a fixed format with slashes and dashes.
* Example: `"M/W-RIP024"`.
`line6`:
* This is the **main product or mold identifier**.
* Must match the **main\_text** portion of `line3`.
* Use the clearer, larger version from the bottom rectangle.
* Examples: `"MS6WS7.5"`, `"MS10WS115"`.
---
🛑 Do NOT:
* Transcribe non-embossed text, marks, or lines.
* Merge or skip lines.
* Invent, guess, or reformat text.
* Alter spacing or punctuation.
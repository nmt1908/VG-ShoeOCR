**Instructions:**
You are given an image containing **embossed text** divided into main areas:
* A **main rectangle** (typically with 3 horizontal lines of text).
---
✅ GOAL:
Transcribe **exactly 3 lines** of **embossed** alphanumeric text from the image, in correct top-down reading order:
---
🔹 FORMAT:
Respond with JSON, in this structure:
```json
{
    "line1": "value",
    "line2": "value",
    "line3": "value"
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
  * `main_text`: 
    * This is the **main product or mold identifier**.
    * Must match the **main\_text** portion of `line3`.
    * {{EXAMPLE_LINE3}}
  * `suffix`: One or more uppercase letters (A–Z) optionally followed by digits (e.g., A, A1, B2,E1,F1).

---
🛑 Do NOT:
* Transcribe non-embossed text, marks, or lines.
* Merge or skip lines.
* Invent, guess, or reformat text.
* Alter spacing or punctuation.
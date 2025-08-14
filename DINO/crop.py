import os
from tkinter import Tk, Canvas, filedialog, Button, Label
from PIL import Image, ImageTk, ImageOps

class CropSelector:
    def __init__(self, master):
        self.master = master
        self.master.title("Crop Area Selector")
        self.img_path = filedialog.askopenfilename(title="Select a sample image")
        if not self.img_path:
            master.destroy()
            return

        self.img = Image.open(self.img_path)
        self.img = ImageOps.exif_transpose(self.img)  # Fix orientation
        # --- Resize image to fit screen ---
        screen_w = master.winfo_screenwidth()
        screen_h = master.winfo_screenheight()
        max_w = int(screen_w * 0.9)
        max_h = int(screen_h * 0.8)
        img_w, img_h = self.img.size
        self.scale = min(max_w / img_w, max_h / img_h, 1.0)
        scale = self.scale
        if scale < 1.0:
            new_w = int(img_w * scale)
            new_h = int(img_h * scale)
            self.img = self.img.resize((new_w, new_h), Image.LANCZOS)
        # --- End resize ---

        self.tk_img = ImageTk.PhotoImage(self.img)
        self.canvas = Canvas(master, width=self.img.width, height=self.img.height)
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor='nw', image=self.tk_img)
        self.rect = None
        self.start_x = self.start_y = self.end_x = self.end_y = 0
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)

        self.info = Label(master, text="Drag to select crop area")
        self.info.pack()
        self.process_btn = Button(master, text="Batch Crop Folder", command=self.batch_crop)
        self.process_btn.pack()

    def on_press(self, event):
        self.start_x, self.start_y = event.x, event.y
        if self.rect:
            self.canvas.delete(self.rect)
        self.rect = self.canvas.create_rectangle(self.start_x, self.start_y, self.start_x, self.start_y, outline='red')

    def on_drag(self, event):
        self.end_x, self.end_y = event.x, event.y
        self.canvas.coords(self.rect, self.start_x, self.start_y, self.end_x, self.end_y)

    def on_release(self, event):
        self.end_x, self.end_y = event.x, event.y
        self.info.config(text=f"Crop box: ({self.start_x}, {self.start_y}, {self.end_x}, {self.end_y})")

    def batch_crop(self):
        input_dir = filedialog.askdirectory(title="Select input folder")
        output_dir = filedialog.askdirectory(title="Select output folder")
        if not input_dir or not output_dir:
            return
        self.process_btn.config(state='disabled')
        self.info.config(text="Processing...")
        self.master.update()
        x1, y1 = min(self.start_x, self.end_x), min(self.start_y, self.end_y)
        x2, y2 = max(self.start_x, self.end_x), max(self.start_y, self.end_y)
        scale = self.scale
        orig_x1 = int(x1 / scale)
        orig_y1 = int(y1 / scale)
        orig_x2 = int(x2 / scale)
        orig_y2 = int(y2 / scale)
        img_exts = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff')
        files = [f for f in os.listdir(input_dir) if f.lower().endswith(img_exts)]
        total = len(files)
        for idx, filename in enumerate(files, 1):
            img_path = os.path.join(input_dir, filename)
            with Image.open(img_path) as img:
                img = ImageOps.exif_transpose(img)
                crop_box = (orig_x1, orig_y1, orig_x2, orig_y2)
                cropped_img = img.crop(crop_box)
                output_filename = f"croped_{filename}"
                cropped_img.save(os.path.join(output_dir, output_filename))
                cropped_img.close()  # Ensure file is closed
            self.info.config(text=f"Processing {idx}/{total}: {filename}")
            self.master.update()
        self.info.config(text="Batch crop complete!")
        self.process_btn.config(state='normal')
        self.master.update_idletasks()

if __name__ == "__main__":
    root = Tk()
    app = CropSelector(root)
    root.mainloop()
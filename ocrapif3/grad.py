import glob

import torch
from torchvision import transforms as T

import gradio as gr


class App:

    title = 'Scene Text Recognition with Permuted Autoregressive Sequence Models'
    models = ['parseq', 'parseq_tiny', 'abinet', 'crnn', 'trba', 'vitstr']

    def __init__(self):
        self._model_cache = {}
        self._preprocess = T.Compose([
            T.Resize((32, 128), T.InterpolationMode.BICUBIC),
            T.ToTensor(),
            T.Normalize(0.5, 0.5)
        ])

    def _get_model(self, name):
        if name in self._model_cache:
            return self._model_cache[name]
        model = torch.hub.load('baudm/parseq', name, pretrained=True).eval()
        model.freeze()
        self._model_cache[name] = model
        return model

    def __call__(self, model_name, image):
        model = self._get_model(model_name)
        image = self._preprocess(image.convert('RGB')).unsqueeze(0)
        # Greedy decoding
        pred = model(image).softmax(-1)
        label, confidence = model.tokenizer.decode(pred)
        return label[0]


def main():

    app = App()

    with gr.Blocks(analytics_enabled=False, title=app.title) as demo:
        gr.Markdown("""
            <div align="center">
            # Scene Text Recognition with<br/>Permuted Autoregressive Sequence Models
            [![GitHub](https://img.shields.io/badge/baudm-parseq-blue?logo=github)](https://github.com/baudm/parseq)
            </div>
            To use this interactive demo for PARSeq and reproduced models:
            1. Select which model you want to use.
            2. Upload your own image, choose from the examples below, or draw on the canvas.
            3. Read the given image or drawing.
        """)
        model_name = gr.Radio(app.models, value=app.models[0], label='Select STR model to use')
        with gr.Row():
            image_upload = gr.Image(type='pil', label='Image')
            image_canvas = gr.Sketchpad(type='pil', label='Drawing')
        with gr.Row():
            read_upload = gr.Button('Read Image')
            read_canvas = gr.Button('Read Drawing')

        output = gr.Textbox(max_lines=1, label='Model output')

        gr.Examples(glob.glob('demo_images/*.*'), inputs=image_upload)

        read_upload.click(app, inputs=[model_name, image_upload], outputs=output)
        read_canvas.click(app, inputs=[model_name, image_canvas], outputs=output)

    demo.launch()


if __name__ == '__main__':
    main()
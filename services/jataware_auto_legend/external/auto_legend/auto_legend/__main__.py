#!/usr/bin/env python3
"""
    auto_legend
    
    Run forward pass on a single image.
"""

import os
import io
import json
import base64
import argparse
from PIL import Image
from pathlib import Path

from rich.console import Console
from rich.text import Text
from rich_pixels import Pixels
from rich.padding import Padding

from rich.console import Console

from auto_legend.modeling.anthropic_ocr import AnthropicOCR
from auto_legend.utils import set_seeds

if 'ANTHROPIC_API_KEY' not in os.environ:
    raise ValueError('ANTHROPIC_API_KEY not found in environment variables')

ANTHROPIC_API_KEY = os.environ['ANTHROPIC_API_KEY']

# --
# Helpers

def b642pil(b64:str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64)))

def print_tree(console, data, parent_id=None, indent=0, depth=0):
    colors = ["cyan", "magenta", "green", "yellow", "blue", "red"]
    color = colors[depth % len(colors)]
    
    for item in data:
        if item.get('parent') == parent_id:
            id_text = Text(str(item['id']), style='bold ' + color)
            console.print(Padding.indent(id_text, indent))
            
            for k, v in item.items():
                if k not in ['id', 'parent']:
                    key_text = Text(f"{k}: ", style=color)
                    if k == '_img_symbol' and v is not None:
                        try:
                            img_symbol    = b642pil(v)
                            # Resize image so height is 32 px
                            aspect_ratio  = img_symbol.width / img_symbol.height
                            new_width     = int(8 * aspect_ratio)
                            img_symbol    = img_symbol.resize((new_width, 8), Image.LANCZOS)
                            img_pix       = Pixels.from_image(img_symbol)
                            console.print(Padding.indent(img_pix, indent + 4))
                        except:
                            console.print(Padding.indent(Text('ERROR: could not display _img_symbol', style='red'), indent + 4))
                    else:
                        value_text = Text(str(v))
                        console.print(Padding.indent(key_text + value_text, indent + 4))
            
            if any(item['id'] == child.get('parent') for child in data):
                children_text = Text("children:", style="italic " + color)
                console.print(Padding.indent(children_text, indent + 4))
            
            print_tree(console, data, parent_id=item['id'], indent=indent + 8, depth=depth + 1)


# --
# CLI

def parse_args():
    parser = argparse.ArgumentParser(description='Train Deformable DETR model')
    parser.add_argument('--data_dir',        type=str, default='/home/paperspace/data/legend_data/bkj')
    parser.add_argument('--tif_dir',         type=str, default='tif')
    parser.add_argument('--crop_dir',        type=str, default='v3_crop_columns')
    parser.add_argument('--detr_model_path', type=str, default='models/column_abbr_002_custom_detr_detector_model_0095.pth')
    parser.add_argument('--seed',            type=int, default=123)
    
    args = parser.parse_args()
    
    args.data_dir    = Path(args.data_dir)
    args.tif_dir     = args.data_dir / args.tif_dir
    args.crop_dir    = args.data_dir / args.crop_dir

    set_seeds(args.seed)
    
    return args


def main():
    args = parse_args()

    ocr_model  = AnthropicOCR(model_path=args.detr_model_path, device='cpu', api_key=ANTHROPIC_API_KEY)

    # Load image
    anns  = [json.loads(line) for line in (args.crop_dir / "annotations.jl").open('r')]
    ann   = anns[1]
    image = Image.open(ann['file_name'])
    image.save('image.png')

    # Run OCR
    console = Console()
    data    = []
    for out in ocr_model.run(image, return_swatches=True):
        data.append(out)
        console.clear()
        print_tree(console, data)


if __name__ == '__main__':
    main()

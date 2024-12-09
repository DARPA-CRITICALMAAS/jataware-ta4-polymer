import io
import re
import json
import base64
from PIL import Image
from typing import List
from rich import print as rprint

import anthropic

from auto_legend.modeling.abbr_detr_predict import AbbrModel

print('!! AnthropicOCR: loading...')

class JSONStreamParser:
    def __init__(self):
        self.buffer       = ""
        self.inside_fence = False
        self.inside_list  = False
        self.inside_dict  = False
        self._text        = []
        self._data        = []
    
    async def process(self, stream):
        async for text in stream:
            for xx in self.process_char(text):
                yield xx
    
    @staticmethod
    def parse_json_from_fence(text):
        pattern = r'```(?:\w*\n)?([\s\S]*?)```'
        matches = re.findall(pattern, text)
        
        if matches:
            json_str = matches[0].strip()
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                print("Failed to parse JSON from the extracted content.")
                return None
        else:
            print("No content found within triple backticks.")
            return None
    
    def process_char(self, char):
        self._text.append(char)
    
        self.buffer += char
        if self.buffer.endswith("```"):
            self.inside_fence = not self.inside_fence
            self.buffer = ""
            return
        
        if self.inside_fence:
            if not self.inside_list and char == "[":
                self.inside_list = True
                self.buffer = ""
                return
            
            if char == "{":
                self.inside_dict = True
                self.buffer = "{"
                return
            
            if char == '}':
                try:
                    obj = json.loads(self.buffer)
                    self._data.append(obj)
                    yield obj
                    
                    self.buffer = ""
                    self.inside_dict = False
                except json.JSONDecodeError:
                    return
                    
    @property
    def is_correct(self):
        ref = self.parse_json_from_fence(''.join(self._text))
        act = self._data
        
        return ref == act


class AnthropicOCR:
    
    PROMPT_PREFILL = """
```
[
    {"""
    
    def __init__(self, model_path:str, device:str, api_key:str):
        self.client     = anthropic.Anthropic(api_key=api_key)
        self.aclient    = anthropic.AsyncAnthropic(api_key=api_key)
        self.abbr_model = AbbrModel(model_path=model_path, device=device)

    @staticmethod
    def pil2b64(img):
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='PNG')
        return base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')

    @staticmethod
    def chunk_image(img:Image.Image, max_dim:int=800, overlap:int=100) -> List[Image.Image]:
        img_chunks = [img.crop((0, 0, max_dim, max_dim))]
        r_offset = 0
        while (r_offset + max_dim) < img.height:
            r_offset += max_dim - overlap
            img_chunks.append(img.crop((0, r_offset, max_dim, r_offset + max_dim)))
            
        return img_chunks
    
    def _get_prompt(self, imgs, no_description):
        PROMPT = ("""
    The legend represents a hierarchical organization of deposits / map information.  
    Please convert this into a list of JSON dictionaries, with the following format:
    ```
    {
        "id"           : str - a unique identifier for the item
        "parent"       : Optional[str] - the id of the parent item.  If no parent, set to null.
        "name"         : str - the name of the item
        "age"          : Optional[str] - the age of the item (if present)
        "description"  : Optional[str] - the description of the item (if present)
        "symbol"       : Optional[str] - the map symbol for the item (if present)
        "symbol_id"    : Optional[int] - the numeric ID for the bounding box of the item. Two digit number in red in upper left corner of item swatch. (if present)
        "category"     : One of ["polygon", "line", "point"] - the type of the item (Polygons are represented by colored / textured rectangles.)
    }
    ```

    Notes:

    - The `id` should be descriptive and unique, in snake case.
    - Some items don't have symbols or symbol IDs.  Remember to capture all section headers / subheaders as items.
    - Remember that the hierarchy may be multiple levels deep.
    - Don't be lazy - transcribe everything!
    """)
        
        if no_description:
            PROMPT = PROMPT.replace('    "description"  : Optional[str] - the description of the item (if present)\n', '')
        
        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": self.pil2b64(img),
                },
            } for img in imgs
        ]
        
        content.append({
            "type": "text",
            "text": PROMPT
        })
        
        return [
            {
                "role": "user",
                "content": content
            },
            {
                "role": "assistant", 
                "content": self.PROMPT_PREFILL  
            }
        ]
    
    def _run_claude(self, imgs, no_description):
        _anthropic_input = dict(
            model      = "claude-3-5-sonnet-20241022",
            max_tokens = 4096,
            messages   = self._get_prompt(imgs, no_description),
        )
        
        response = self.client.messages.create(**_anthropic_input)
        response = self.PROMPT_PREFILL + response.content[0].text
        print('AnthropicOCR: response', response)
        return response
    
    def run(self, img, no_description=False):
        
        # --
        # Preprocessing
        
        img.save('legend_image_original.png')
        
        print('AnthropicOCR: Detecting swatches...')
        img_tfm, preds, preds_orig = self.abbr_model.predict(img)
        img_tfm.save('legend_img_tfm.png')
        
        print('AnthropicOCR: Annotating image...')
        img_som = self.abbr_model.annotate_image(img_tfm, preds)
        img_som.save('legend_image_som.png')
        
        print('AnthropicOCR: Chunking image...')
        img_chunks = self.chunk_image(img_som, max_dim=800, overlap=100)
        for i, chunk in enumerate(img_chunks):
            chunk.save(f'legend_image_chunk_{i:03d}.png')
        
        # --
        # Run
        
        print('AnthropicOCR: Running OCR...')
        data = self._run_claude(img_chunks, no_description=no_description)
        data = JSONStreamParser.parse_json_from_fence(data)
        
        print('AnthropicOCR: data', data)
        
        for item in data:
            if item['symbol_id'] is not None:
                item['bbox'] = preds_orig[item['symbol_id']].xyxy
        
        # testing
        for item in data:
            if item['symbol_id'] is not None:
                img.crop(item['bbox']).save(f'legend_image_item_{item["symbol"]}_{item["symbol_id"]}.png')
        
        return data

    async def _run_claude_streaming(self, imgs:List[Image.Image], no_description:bool=False):
        _anthropic_input = dict(
            model      = "claude-3-5-sonnet-20241022",
            max_tokens = 4096,
            messages   = self._get_prompt(imgs, no_description),
        )
        
        for char in self.PROMPT_PREFILL:
            yield char
        
        async with self.aclient.messages.stream(**_anthropic_input) as stream:
            async for text in stream.text_stream:
                for char in text:
                    yield char

    async def run_streaming(self, img:Image.Image, save_images:bool=False, no_description:bool=False):
        try:
            img = img.convert('RGB')
            
            # --
            # Preprocessing
            
            img.save('legend_image_original.png')
            
            print('AnthropicOCR: Detecting swatches...')
            img_tfm, preds, preds_orig = self.abbr_model.predict(img)
            img_tfm.save('legend_img_tfm.png')
            yield {"__progress" : 25, "__status" : "OK"}
            
            print('AnthropicOCR: Annotating image...')
            img_som = self.abbr_model.annotate_image(img_tfm, preds)
            img_som.save('legend_image_som.png')
            yield {"__progress" : 50, "__status" : "OK"}
            
            print('AnthropicOCR: Chunking image...')
            img_chunks = self.chunk_image(img_som, max_dim=800, overlap=100)
            yield {"__progress" : 75, "__status" : "OK"}
            
            for i, chunk in enumerate(img_chunks):
                chunk.save(f'legend_image_chunk_{i:03d}.png')
            
            
            # --
            # Run
            
            print('AnthropicOCR: Running OCR...')
            parser = JSONStreamParser()
            async for item in parser.process(self._run_claude_streaming(img_chunks, no_description=no_description)):
                if item['symbol_id'] is not None:
                    item['bbox'] = preds_orig[item['symbol_id']].xyxy
                if item['symbol_id'] is not None:
                    img.crop(item['bbox']).save(f'legend_image_item_{item["symbol"]}_{item["symbol_id"]}.png')

                print('run_streaming: ', item)
                yield item
            
            rprint('run_streaming: parser._text', ''.join(parser._text))
            rprint('run_streaming: parser.is_correct', parser.is_correct)
            
            yield {"__progress" : 100, "__status" : "OK"}
        
        except Exception as e:
            yield {"__progress" : 100, "__status" : "ERROR", "__error" : str(e)}
    

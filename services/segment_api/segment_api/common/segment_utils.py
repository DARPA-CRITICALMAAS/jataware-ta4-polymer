import logging
import os
from itertools import groupby
from logging import Logger

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from tifffile import imread as tiffread
from transformers import SamModel, SamProcessor

from segment_api.common.tiff_cache import get_cached_tiff
from segment_api.common.utils import download_file_polymer, s3_key_exists, timeit, upload_s3_file
from segment_api.http.routes.cache import segment_cache
from segment_api.settings import app_settings

logger: Logger = logging.getLogger(__name__)


class SegmentFloodFill:
    """
    Class to chunk the image and flood fill the points
    """

    class EmbeddingsNotFoundError(IOError):
        pass

    class ModelWeightsNotFoundError(IOError):
        pass

    def __init__(self, cog_id, *, tile_size=1024):
        logger.info("Initializing SegmentFloodFill")

        self.cog_id = cog_id
        self.embeds_path = f"{app_settings.disk_cache_dir}/{self.cog_id}_embeds.pt"
        self.s3_embeds_path = f"{app_settings.s3_cog_embedding_prefix}/{self.cog_id}/embeds.pt"

        self.image = read_cog(cog_id)
        logger.info(f"Image shape: {self.image.shape}")
        self.image = normalize_image(self.image)
        logger.info(f"Image shape: {self.image.shape}")

        self.nrow, self.ncol, self.nchannels = self.image.shape

        self.tile_size = tile_size
        self.pad_image()
        self.make_tiles()

        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.device = "cuda" if torch.cuda.is_available() else self.device
        self.device = torch.device(self.device)

        try:
            weights = torch.load(app_settings.sam_model_path, self.device, weights_only=True)
        except IOError as e:
            raise SegmentFloodFill.ModelWeightsNotFoundError("Failed to load model weights") from e

        self.processor = SamProcessor.from_pretrained("facebook/sam-vit-base")
        self.model = SamModel.from_pretrained(
            "facebook/sam-vit-base",
            state_dict=weights,
            use_safetensors=True,
        )
        self.model.to(self.device)
        self.model.eval()

        logger.info("Finished initializing SegmentFloodFill")

    def pad_image(self):
        """
        Pad the image to be divisible by the tile size
        """
        self.row_pad = self.tile_size - self.nrow % self.tile_size
        self.col_pad = self.tile_size - self.ncol % self.tile_size
        logger.info(f"Padding image by {self.row_pad} rows and {self.col_pad} columns")
        self.image = np.pad(self.image, ((0, self.row_pad), (0, self.col_pad), (0, 0)))
        logger.info(f"Image shape: {self.image.shape}")

    def make_tiles(self):
        """
        Turn large image into set of tiles for processing by SAM model
        """
        self.tiles = []
        self.tiles_indices = []
        for r in range(self.nrow // self.tile_size):
            for c in range(self.ncol // self.tile_size):
                pr = r * self.tile_size
                pc = c * self.tile_size
                tile = self.image[pr : pr + self.tile_size, pc : pc + self.tile_size]
                self.tiles.append(tile)
                self.tiles_indices.append((r, c))

    @timeit(logger)
    def generate_embeds(self):
        """
        Create image embeddings of the tiles using the SAM model Image encoder, save embeds for later
        """
        batch_size = 4
        n_tiles = len(self.tiles)
        embeds = []

        logger.info(f"Embedding {n_tiles} tiles")

        for i, images in enumerate(batched(self.tiles, batch_size)):
            logger.info(f"Embeddings complete: {i * batch_size} out of {n_tiles}")
            inputs = self.processor(images=images, return_tensors="pt").to(self.device)
            pix = inputs.pixel_values
            embeds.append(self.model.get_image_embeddings(pix))

        logger.info(f"Embeddings complete: {n_tiles} out of {n_tiles}")
        self.embeds = torch.cat(embeds)

    def load_embeds(self):
        """
        Load the embeddings from the disk or s3.
        """
        if not os.path.isfile(self.embeds_path):
            download_file_polymer(s3_key=self.s3_embeds_path, local_file_path=self.embeds_path)

        try:
            self.embeds = torch.load(self.embeds_path, self.device, weights_only=True)
        except IOError as e:
            raise SegmentFloodFill.EmbeddingsNotFoundError(f"Failed to load embeddings for {self.cog_id}") from e

        self.embeds = self.embeds.to(self.device)

    def upload_embeds(self, overwrite=False):
        """
        Upload the embeddings to s3 from disk if available, otherwise generate them
        """
        # embeddings exist in s3
        if not overwrite and s3_key_exists(self.s3_embeds_path):
            logger.info("Embeddings exist in s3")
            return

        # embeddings exist locally
        if not overwrite and os.path.isfile(self.embeds_path):
            logger.info("Embeddings exist locally, uploading to s3")
            upload_s3_file(self.s3_embeds_path, app_settings.polymer_public_bucket, self.embeds_path)
            return

        logger.info("Embeddings do not exist or are being overwritten, generating and uploading to s3...")
        self.generate_embeds()
        self.embeds = self.embeds.to(self.device)
        torch.save(self.embeds, self.embeds_path)
        upload_s3_file(self.s3_embeds_path, app_settings.polymer_public_bucket, self.embeds_path)

    def find_center_sequences(self, arr, threshold=64):
        """
        Find the middle indices of a sequence of non-zeros in an array
            - arr: the input array
            - threshold: the minimum length of the sequence
        """
        index = 0
        indices = []
        for k, group in groupby(arr):
            group_list = list(group)
            length = len(group_list)

            if k and length > threshold:
                indices.append(index + length // 2)
            index += length
        return indices

    def find_edge_points(self, mask, thickness=3, threshold=0.9, buf=1):
        """
        Find the points on the edges of the neighboring tiles
            - mask: the mask of the tile
            - thickness: the thickness of the edge
            - threshold: the threshold for the edge
        """

        top_rows = mask[:thickness, :].type(torch.int8)
        bottom_rows = mask[-thickness:, :].type(torch.int8)
        left_cols = mask[:, :thickness].type(torch.int8)
        right_cols = mask[:, -thickness:].type(torch.int8)

        top_row = torch.mean(top_rows, 0, dtype=torch.float16) > threshold
        bottom_row = torch.mean(bottom_rows, 0, dtype=torch.float16) > threshold
        left_col = torch.mean(left_cols, -1, dtype=torch.float16) > threshold
        right_col = torch.mean(right_cols, -1, dtype=torch.float16) > threshold

        top_indices = self.find_center_sequences(top_row)
        bottom_indices = self.find_center_sequences(bottom_row)
        left_indices = self.find_center_sequences(left_col)
        right_indices = self.find_center_sequences(right_col)

        top_points = [(-buf, i) for i in top_indices]
        bottom_points = [(self.tile_size + buf, i) for i in bottom_indices]
        left_points = [(i, -buf) for i in left_indices]
        right_points = [(i, self.tile_size + buf) for i in right_indices]

        return top_points + bottom_points + left_points + right_points

    def get_tile_point(self, point):
        """
        Get the tile, tile indices, point indices, and tile index for a given point
            - point: the input point
        """

        p_r, p_c = point
        tile_r = p_r // self.tile_size
        tile_c = p_c // self.tile_size
        tile_idx = self.tiles_indices.index((tile_r, tile_c))
        r_start, c_start = tile_r * self.tile_size, tile_c * self.tile_size
        tile_pr = p_r - r_start
        tile_pc = p_c - c_start
        tile = self.tiles[tile_idx]
        return tile, (tile_r, tile_c), (tile_pr, tile_pc), tile_idx

    def reindex_img2tile(self, points, labels):
        """
        Reindex the points and labels from the total image space to the tile space
            - points: the input points
            - labels: the input labels
        """
        pts, lbs = {}, {}
        for i, p in enumerate(points):
            _, _, point, tile_idx = self.get_tile_point(p)
            if tile_idx not in pts:
                pts[tile_idx] = []
                lbs[tile_idx] = []
            pts[tile_idx].append(point)
            lbs[tile_idx].append(labels[i])
        return pts, lbs

    def reindex_tile2img(self, points, tile_idx):
        """
        Reindex the points from the tile space to the total image space
            - points: the input points (from a single tile)
            - tile_idx: the input tile index
        """
        r, c = self.tiles_indices[tile_idx]
        points_out = []
        for p in points:
            pr = p[0] + (r * self.tile_size)
            pc = p[1] + (c * self.tile_size)
            if 0 <= pr < self.nrow and 0 <= pc < self.ncol:
                points_out.append([pr, pc])
        return points_out

    def pts2tensor(self, points, labels):
        """
        Prepare the points for the SAM inputs
            - points: the input points
            - labels: the input labels
        """
        idx = list(points.keys())
        max_pts = max([len(p) for p in points.values()])
        for k in idx:
            if len(points[k]) < max_pts:
                points[k] += [[0, 0]] * (max_pts - len(points[k]))
                labels[k] += [-10] * (max_pts - len(labels[k]))
        points = {k: [[p[1], p[0]] for p in points[k]] for k in points}  # have to be reversed for SAM

        pts = torch.stack([torch.tensor(points[k]) for k in idx]).unsqueeze(1).to(self.device)
        lbs = torch.stack([torch.tensor(labels[k]) for k in idx]).unsqueeze(1).to(self.device)
        idx = torch.tensor(idx).long().to(self.device)
        return pts, lbs, idx

    def flood_fill(self, points_orig, labels_orig, n_iter=3, mask_thresh=0.9):
        """
        Iteratively floodfill the edges of the tiles ... n_iter=1 is just normal forward pass
            - points_orig: the input points
            - labels_orig: the input labels
            - n_iter: the number of iterations
            - mask_thresh: the mask threshold

        """

        # initialize in tile space
        points = points_orig.copy()
        labels = labels_orig.copy()
        source = ["orig" for _ in range(len(points))]

        for i in range(n_iter):
            # img -> tile space
            _pts, _lbs = self.reindex_img2tile(points, labels)

            # pts -> tensor
            _pts_tensor, _lbs_tensor, _idx_tensor = self.pts2tensor(_pts, _lbs)

            # segment tiles w/ pts
            with torch.no_grad():
                out = self.model(
                    image_embeddings=self.embeds[_idx_tensor],
                    input_points=_pts_tensor,
                    input_labels=_lbs_tensor,
                    multimask_output=False,
                )
                masks = out.pred_masks.squeeze(2)

            # upsample masks
            masks = F.interpolate(masks, size=(1024, 1024), mode="nearest").squeeze(1)
            masks = masks > mask_thresh

            if n_iter == 1:
                break

            # find edge points in masks
            _pts_new, _lbs_new = [], []
            for i, mask in enumerate(masks):
                edge_pts = self.find_edge_points(mask)

                # tile -> src
                edge_pts = self.reindex_tile2img(edge_pts, _idx_tensor[i].item())
                _pts_new.extend(edge_pts)
                _lbs_new.extend([1] * len(edge_pts))

            # update points
            if len(_pts_new) == 0:
                break
            else:
                points.extend(_pts_new)
                labels.extend(_lbs_new)
                source.extend([f"iter_{i}" for _ in range(len(_pts_new))])

        # create output mask
        mask_out = np.zeros((self.nrow, self.ncol), dtype=np.uint8)
        for ii in range(len(masks)):
            r, c = self.tiles_indices[_idx_tensor[ii].item()]
            r_start, c_start = r * self.tile_size, c * self.tile_size
            r_end = min(r_start + self.tile_size, self.nrow)
            c_end = min(c_start + self.tile_size, self.ncol)
            mask_out[r_start:r_end, c_start:c_end] = (
                masks[ii][: r_end - r_start, : c_end - c_start].cpu().numpy().astype(np.uint8)
            )

        # Shift the mask to center after downsampling offset
        # TODO: This is a temporary fix for the offset issue
        shift = 4
        mask_out = np.roll(mask_out, shift=(-shift, -shift), axis=(0, 1))
        mask_out[:shift, :] = 0  # Set the top 2 rows to zeros
        mask_out[:, :shift] = 0  # Set the left 2 columns to zeros

        return None, mask_out  # possibly return the points / labels to display / debug


class LassoTool:
    """
    Wrapper around the OpenCV IntelligentScissorsMB tool to detect edges on images
    """

    def __init__(self, cog_id):
        self.tool = cv2.segmentation.IntelligentScissorsMB()
        self.tool.setEdgeFeatureCannyParameters(32, 100)
        self.tool.setGradientMagnitudeMaxLimit(200)

        self.start_coordinate = np.array([0, 0], dtype=np.int32)
        self.crop_size = 1024

        self.image = read_cog(cog_id)
        self.image = normalize_image(self.image)

        self.height, self.width, self.channels = self.image.shape

    def crop_image(self, center_x, center_y):
        """
        Crop the image around the specified center point with black padding if necessary
        """

        half_crop_size = self.crop_size // 2
        left = center_x - half_crop_size
        right = center_x + half_crop_size
        top = center_y - half_crop_size
        bottom = center_y + half_crop_size

        # Initialize the output image with black padding
        padded_crop = np.zeros((self.crop_size, self.crop_size, self.channels), dtype=np.uint8)

        # Check if the crop area is completely outside the image boundaries
        if left >= self.width or right <= 0 or top >= self.height or bottom <= 0:
            return padded_crop

        # Calculate the intersection box between the image and the crop area
        crop_left = max(left, 0)
        crop_right = min(right, self.width)
        crop_top = max(top, 0)
        crop_bottom = min(bottom, self.height)

        # Calculate the corresponding coordinates on the padded_crop
        pad_left = crop_left - left
        pad_top = crop_top - top

        # Insert the cropped part of the image into the padded_crop
        padded_crop[
            pad_top : pad_top + (crop_bottom - crop_top),
            pad_left : pad_left + (crop_right - crop_left),
        ] = self.image[crop_top:crop_bottom, crop_left:crop_right]

        return padded_crop

    def convert_coordinate(self, coordinate):
        """
        Convert the coordinate from the OpenLayers image space to the OpenCV image space
        """

        x, y = coordinate
        return np.array([x, self.height - y], dtype=np.int32)

    def apply_image(self, *, filter_count=2):
        """
        Apply the cropped image to the tool after the start_coordinate and crop_size have been set
        """

        # Centered image from buffer with padding
        crop_image = self.crop_image(*self.start_coordinate)
        image = crop_image.copy()

        k = np.ones((5, 5), np.uint8)
        for _ in range(filter_count):
            image = cv2.fastNlMeansDenoisingColored(image, None, 16, 8)
            image = cv2.morphologyEx(image, cv2.MORPH_OPEN, k, iterations=1)

        self.tool.applyImage(image)

    def build_map(self):
        """
        Build the map for the current image
        """

        center = np.array([self.crop_size // 2, self.crop_size // 2], dtype=np.int32)
        self.tool.buildMap(center)

    def get_interpolation(self, coordinate):
        """
        Get a coordinate inside the cropped image.
        """

        x, y = coordinate

        # Calculate the center of the square
        cx, cy = self.crop_size / 2, self.crop_size / 2

        # Check if the point is inside the square
        if abs(x - cx) <= self.crop_size / 2 and abs(y - cy) <= self.crop_size / 2:
            return x, y

        # Direction vector
        dx = x - cx
        dy = y - cy

        # Magnitude of direction vector
        mag = np.sqrt(dx**2 + dy**2)

        # Normalized direction vector
        ux = dx / mag
        uy = dy / mag

        # Calculate intersection distances
        t_left = (-self.crop_size / 2) / ux if ux != 0 else float("inf")
        t_right = (self.crop_size / 2) / ux if ux != 0 else float("inf")
        t_top = (self.crop_size / 2) / uy if uy != 0 else float("inf")
        t_bottom = (-self.crop_size / 2) / uy if uy != 0 else float("inf")

        # Filter for positive distances
        t_min = min([t for t in [t_left, t_right, t_top, t_bottom] if t > 0])

        # Intersection point
        ix = cx + t_min * ux
        iy = cy + t_min * uy

        return np.array([ix, iy], dtype=np.int32)

    def clamp_coordinate(self, coordinate):
        """
        Clamp the coordinate to the image boundaries
        """

        x, y = coordinate
        x = max(0, min(x, self.crop_size - 1))
        y = max(0, min(y, self.crop_size - 1))
        return np.array([x, y], dtype=np.int32)

    def convert_crop_coordinate(self, coordinate, interpolate=False):
        """
        Convert the coordinate from the OpenLayers image space to the OpenCV cropped image space
        """

        coordinate = self.convert_coordinate(coordinate)
        coordinate = coordinate - self.start_coordinate + self.crop_size // 2

        if interpolate:
            coordinate = self.get_interpolation(coordinate)
        coordinate = self.clamp_coordinate(coordinate)

        return coordinate

    def convert_contour(self, contour):
        """
        Convert the contour from the OpenCV cropped image space to the OpenLayers image space
        """

        contour += self.start_coordinate - self.crop_size // 2
        contour = np.array([0, self.height]) + contour * np.array([1, -1])
        return contour

    def get_contour(self, coordinate):
        """
        Get the contour for the specified crop coordinate, returns None if there was an error
        """

        try:
            contour = self.tool.getContour(coordinate)
        except cv2.error:  # pylint: disable=catching-non-exception
            return None

        # Collapse contour from (N, 1, 2) to (N, 2)
        # Unsure why the contour is returned as a 3D array, so check in case the shape is unexpected
        assert contour.shape[1] == 1
        contour = contour.squeeze(axis=1)

        return contour


def normalize_image(image):
    """
    Normalize the image to have 3 channels
    """

    # If no channels, copy the image to 3 channels
    if image.ndim == 2:
        image = np.stack((image,) * 3, axis=-1)

    # If 1 channel, copy the channel to 3 channels
    if image.shape[2] == 1:
        image = np.stack((image.squeeze(axis=2),) * 3, axis=-1)

    return image


@timeit(logger)
def quick_cog(cog_id):
    """
    Quickly read a COG image.

    Checks if the lasso tool is available to avoid redoing a numpy tiff read.
    Otherwise, reads the image from the disk cache.
    """

    lasso_tool = ToolCache(cog_id).lasso
    if lasso_tool is None:
        get_cached_tiff(cog_id)
        logger.info(f"Slow reading of COG {cog_id} from disk cache")
        return read_cog(cog_id)
    else:
        logger.info(f"Quick reading of COG {cog_id} from lasso tool")
        return lasso_tool.image


def read_cog(cog_id):
    """
    Read a COG image from the local cache and return it as a numpy array
    """

    image_path = app_settings.disk_cache_dir + f"/{cog_id}.cog.tif"
    return np.array(tiffread(image_path))


def batched(iterable, n):
    """
    Yield batches of n elements from an iterable. Should use `itertools.batched` directly if possible.
    """

    import itertools

    if "batched" in dir(itertools):
        yield from itertools.batched(iterable, n)
        return

    if n < 1:
        raise ValueError("n must be at least one")
    iterator = iter(iterable)
    while batch := tuple(itertools.islice(iterator, n)):
        yield batch


def rgb_to_hsl(rgb):
    """
    Convert an RGB color to HSL
    """
    r, g, b = rgb
    r /= 255.0
    g /= 255.0
    b /= 255.0

    max_color = max(r, g, b)
    min_color = min(r, g, b)
    l = (max_color + min_color) / 2.0

    if max_color == min_color:
        h = s = 0.0
    else:
        d = max_color - min_color
        s = d / (2.0 - max_color - min_color) if l > 0.5 else d / (max_color + min_color)

        if max_color == r:
            h = (g - b) / d + (6.0 if g < b else 0.0)
        elif max_color == g:
            h = (b - r) / d + 2.0
        else:
            h = (r - g) / d + 4.0
        h /= 6.0

    return (h * 360.0, s * 100.0, l * 100.0)


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join([c * 2 for c in hex_color])
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


class ToolCache:
    """
    Cache for the segment and lasso tools
    """

    segment: SegmentFloodFill | None
    lasso: LassoTool | None

    class Item:
        def __init__(self, id: str):
            self.id = id

        def check(self):
            return self.id in segment_cache.keys()

        def get(self):
            logger.info(f"Checking segment_cache={list(segment_cache.keys())} for {self.id}")
            if self.check():
                return segment_cache[self.id]
            else:
                return None

        def set(self, item):
            segment_cache[self.id] = item

    def __init__(self, cog_id: str):
        self.cog_id = cog_id
        self.create_property("segment")
        self.create_property("lasso")

    def create_property(self, name):
        """
        Create a property with getter and setter methods for the specified cache item type
        """

        setattr(self, f"_{name}", ToolCache.Item(f"{self.cog_id}_{name}"))

        def getter(self):
            return getattr(self, f"_{name}").get()

        def setter(self, item):
            getattr(self, f"_{name}").set(item)

        setattr(self.__class__, name, property(getter, setter))

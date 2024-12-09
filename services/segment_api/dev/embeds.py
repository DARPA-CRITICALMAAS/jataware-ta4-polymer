import sys
import logging
from segment_api.common.segment_utils import SegmentFloodFill

def main():
    logging.basicConfig(level=logging.DEBUG)
    cog_id = sys.argv[1]
    segment = SegmentFloodFill(cog_id)
    segment.upload_embeds(overwrite=True)

if __name__ == "__main__":
    main()

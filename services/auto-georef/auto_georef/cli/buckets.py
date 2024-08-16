import json

from auto_georef.common.utils import s3_client

from ..settings import app_settings

s3 = s3_client(app_settings.polymer_s3_endpoint_url)
s3.create_bucket(Bucket="common.polymer.rocks")

policy = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
            "Resource": ["arn:aws:s3:::common.polymer.rocks"],
        },
        {
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": [
                "s3:ListMultipartUploadParts",
                "s3:PutObject",
                "s3:AbortMultipartUpload",
                "s3:DeleteObject",
                "s3:GetObject",
            ],
            "Resource": ["arn:aws:s3:::common.polymer.rocks/*"],
        },
    ],
}
response = s3.put_bucket_policy(Bucket='common.polymer.rocks"', Policy=json.dumps(policy))

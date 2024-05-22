import io
import logging
from logging import Logger

import boto3
from botocore.exceptions import ClientError

logger: Logger = logging.getLogger(__name__)


# s3 client builder
def aws_s3_client(profile=""):
    if profile:
        session = boto3.session.Session(profile_name=profile)
    else:
        session = boto3.session.Session()
    s3 = session.client("s3", endpoint_url="https://s3.amazonaws.com", verify=False)
    return s3


def s3_client(s3_endpoint_url):
    s3 = boto3.client("s3", endpoint_url=s3_endpoint_url, verify=False)
    return s3


def upload_s3_file(s3, s3_bucket, s3_key, fp):
    s3.upload_file(fp, s3_bucket, s3_key)


def s3_presigned_url(s3, s3_bucket, s3_key, expiration=300):
    try:
        response = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": s3_bucket,
                "Key": s3_key,
            },
            ExpiresIn=expiration,
        )
        return response
    except ClientError as e:
        logger.exception(e)
        return None


def upload_s3_bytes(s3, s3_bucket, s3_key, xs: bytes):
    s3.put_object(Body=xs, Bucket=s3_bucket, Key=s3_key)


def upload_s3_str(s3, s3_key, sz):
    buff = io.BytesIO()
    buff.write(sz.encode())
    upload_s3_bytes(s3_key, buff.getvalue())


def read_s3_contents(s3, s3_bucket, s3_key):
    try:
        data = s3.get_object(Bucket=s3_bucket, Key=s3_key)
        contents = data["Body"].read()
        return contents
    except s3.exceptions.NoSuchKey:
        logger.warning("NoSuchKey - %s", s3_key)
        raise Exception("Key Not Found") from None

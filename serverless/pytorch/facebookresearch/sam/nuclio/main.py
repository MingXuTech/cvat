# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

import json
import base64
from PIL import Image
import io
from model_handler import ModelHandler


def init_context(context):
    context.logger.info("Init context...  0%")
    model = ModelHandler()
    context.user_data.model = model
    context.logger.info("Init context...100%")


def handler(context, event):
    context.logger.info("call handler")
    data = event.body
    if isinstance(data, (bytes, bytearray)):
        data = data.decode("utf-8")
    if isinstance(data, str):
        data = json.loads(data)

    if not isinstance(data, dict):
        raise TypeError(f"Unexpected payload type: {type(data).__name__}")

    buf = io.BytesIO(base64.b64decode(data["image"]))
    image = Image.open(buf)
    image = image.convert("RGB")  #  to make sure image comes in RGB
    features = context.user_data.model.handle(image)

    return context.Response(
        body=json.dumps(
            {
                "blob": base64.b64encode(
                    features.cpu().numpy() if features.is_cuda else features.numpy()
                ).decode(),
            }
        ),
        headers={},
        content_type="application/json",
        status_code=200,
    )

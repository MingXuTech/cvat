from __future__ import annotations

import json

from model_handler import ModelHandler


def init_context(context):
    context.logger.info("Init context... 0%%")
    context.user_data.model = ModelHandler()
    context.logger.info("Init context... 100%%")


def handler(context, event):
    context.logger.info("Run CountGD point proposer")
    data = event.body
    if isinstance(data, (bytes, bytearray)):
        data = data.decode("utf-8")
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        raise TypeError(f"Unexpected payload type: {type(data).__name__}")

    results = context.user_data.model.infer(
        data["image"],
        threshold=data.get("threshold"),
        prompt=data.get("prompt"),
        points=data.get("pos_points"),
        obj_bbox=data.get("obj_bbox"),
    )

    return context.Response(
        body=json.dumps(results),
        headers={},
        content_type="application/json",
        status_code=200,
    )

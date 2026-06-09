from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def _parse_sequence(raw: str, expected_size: int) -> list[list[float]]:
    value = (raw or "").strip()
    if not value:
        return []

    if value.startswith("["):
        parsed = json.loads(value)
    else:
        parsed = []
        for chunk in value.split(";"):
            chunk = chunk.strip()
            if not chunk:
                continue
            parsed.append([float(part.strip()) for part in chunk.split(",")])

    if not isinstance(parsed, list):
        raise ValueError("Expected a list of exemplars")

    normalized = []
    for item in parsed:
        if not isinstance(item, (list, tuple)) or len(item) != expected_size:
            raise ValueError(f"Each item must contain exactly {expected_size} values")
        normalized.append([float(part) for part in item])
    return normalized


class ModelHandler:
    def __init__(self) -> None:
        self.upstream_url = os.getenv(
            "COUNTGD_UPSTREAM_URL",
            "http://host.docker.internal:8000/api/count_image",
        ).strip()
        self.request_timeout = float(os.getenv("COUNTGD_REQUEST_TIMEOUT", "180"))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.default_prompt = os.getenv("COUNTGD_CAPTION", "bacteria").strip() or "bacteria"
        self.default_points = _parse_sequence(
            os.getenv("COUNTGD_EXEMPLAR_POINTS", ""),
            expected_size=2,
        )
        self.default_boxes = _parse_sequence(
            os.getenv("COUNTGD_EXEMPLAR_BOXES", ""),
            expected_size=4,
        )

    def infer(
        self,
        image_base64: str,
        *,
        threshold: float | None = None,
        prompt: str | None = None,
        points: list[list[float]] | None = None,
        obj_bbox: list[list[float]] | None = None,
    ) -> dict[str, list]:
        resolved_points = points if points is not None else self.default_points
        resolved_boxes = obj_bbox if obj_bbox is not None else self.default_boxes
        if (
            isinstance(resolved_boxes, list)
            and len(resolved_boxes) == 2
            and all(isinstance(item, (list, tuple)) and len(item) == 2 for item in resolved_boxes)
        ):
            resolved_boxes = [
                [
                    float(resolved_boxes[0][0]),
                    float(resolved_boxes[0][1]),
                    float(resolved_boxes[1][0]),
                    float(resolved_boxes[1][1]),
                ]
            ]
        if bool(resolved_points) == bool(resolved_boxes):
            raise RuntimeError(
                "Configure exactly one of COUNTGD_EXEMPLAR_POINTS or COUNTGD_EXEMPLAR_BOXES"
            )

        payload: dict[str, object] = {
            "image_base64": image_base64,
            "prompt": (prompt or self.default_prompt).strip() or self.default_prompt,
            "box_threshold": None if threshold is None else float(threshold),
            "image_name": "<cvat-frame>",
        }
        if resolved_points:
            payload["points"] = [
                {"x": int(round(point[0])), "y": int(round(point[1]))}
                for point in resolved_points
            ]
        else:
            payload["exemplar_boxes"] = [
                {"x0": box[0], "y0": box[1], "x1": box[2], "y1": box[3]}
                for box in resolved_boxes
            ]

        request = urllib.request.Request(
            self.upstream_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=self.request_timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"CountGD upstream returned HTTP {exc.code}: {detail[:500]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Cannot reach CountGD upstream: {exc}") from exc

        points = []
        scores = []
        for detection in body.get("detections", []):
            points.append(
                [
                    (float(detection["x0"]) + float(detection["x1"])) / 2,
                    (float(detection["y0"]) + float(detection["y1"])) / 2,
                ]
            )
            scores.append(float(detection["score"]))

        return {
            "points": points,
            "scores": scores,
        }

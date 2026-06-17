from __future__ import annotations

import base64
import io
import json
import os
import sys
import uuid
import urllib.error
import urllib.request

import numpy as np
import torch
from PIL import Image
from segment_anything import SamPredictor, sam_model_registry


def _get_nuclio_worker_id():
    for index, arg in enumerate(sys.argv):
        if arg == "--worker-id" and index + 1 < len(sys.argv):
            return int(sys.argv[index + 1])
        if arg.startswith("--worker-id="):
            return int(arg.split("=", 1)[1])
    return 0


def _to_cvat_mask(box: list[int], mask: np.ndarray) -> list[int]:
    xtl, ytl, xbr, ybr = box
    flattened = mask[ytl : ybr + 1, xtl : xbr + 1].flat[:].astype(int).tolist()
    flattened.extend([xtl, ytl, xbr, ybr])
    return flattened


def _mask_tight_box(mask: np.ndarray) -> list[int] | None:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        return None

    return [
        int(xs.min()),
        int(ys.min()),
        int(xs.max()),
        int(ys.max()),
    ]


def _embedding_shape(num_values: int) -> tuple[int, int, int, int] | None:
    channels = 256
    if num_values <= 0 or num_values % channels:
        return None

    side = int(round((num_values // channels) ** 0.5))
    if side * side * channels != num_values:
        return None

    return (1, channels, side, side)


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_threshold_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default

    try:
        threshold = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid {name}: {raw!r}") from exc

    if not 0 <= threshold <= 1:
        raise RuntimeError(f"{name} must be between 0 and 1")

    return threshold


def _parse_label_map(raw: str | None) -> dict[int, str]:
    if not raw:
        return {}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid RFDETR_LABEL_MAP: {exc}") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("RFDETR_LABEL_MAP must be a JSON object")

    label_map: dict[int, str] = {}
    for key, value in parsed.items():
        if not isinstance(value, str) or not value.strip():
            continue
        try:
            label_map[int(key)] = value.strip()
        except (TypeError, ValueError) as exc:
            raise RuntimeError(f"Invalid RFDETR_LABEL_MAP key: {key!r}") from exc
    return label_map


def _parse_upstream_urls() -> list[str]:
    raw_urls = os.getenv("RFDETR_UPSTREAM_URLS", "").strip()
    if raw_urls:
        urls = [url.strip() for url in raw_urls.split(",") if url.strip()]
    else:
        urls = [
            os.getenv(
                "RFDETR_UPSTREAM_URL",
                "http://host.docker.internal:8787/api/detect",
            ).strip()
        ]

    if not urls:
        raise RuntimeError("RFDETR_UPSTREAM_URLS must contain at least one URL")

    return urls


class ModelHandler:
    def __init__(self) -> None:
        self.worker_id = _get_nuclio_worker_id()
        self.upstream_urls = _parse_upstream_urls()
        self.upstream_url_offset = self.worker_id % len(self.upstream_urls)
        self.request_timeout = float(os.getenv("RFDETR_REQUEST_TIMEOUT", "300"))
        self.model_key = os.getenv("RFDETR_MODEL_KEY", "new").strip() or "new"
        self.min_threshold = _parse_threshold_env("RFDETR_MIN_THRESHOLD", 0.2)
        self.default_threshold = _parse_threshold_env(
            "RFDETR_DEFAULT_THRESHOLD",
            self.min_threshold,
        )
        self.label_map = _parse_label_map(os.getenv("RFDETR_LABEL_MAP"))
        raw_label = os.getenv("RFDETR_LABEL")
        self.label = (raw_label if raw_label is not None else "芽孢").strip()
        if not self.label and not self.label_map:
            self.label = "芽孢"
        self.filter_budspore = _parse_bool(os.getenv("RFDETR_FILTER_BUDSPORE"), True)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.sam_checkpoint = os.getenv(
            "SAM_CHECKPOINT",
            "/opt/nuclio/sam/sam_vit_h_4b8939.pth",
        ).strip()
        self.sam_model_type = os.getenv("SAM_MODEL_TYPE", "vit_h").strip() or "vit_h"
        self.device = self._resolve_device()
        sam_model = sam_model_registry[self.sam_model_type](checkpoint=self.sam_checkpoint)
        sam_model.to(device=self.device)
        self.predictor = SamPredictor(sam_model)
        print(
            "RF-DETR+SAM worker "
            f"{self.worker_id} upstream={self._ordered_upstream_urls()[0]} "
            f"all_upstreams={self.upstream_urls}",
            flush=True,
        )

    def _resolve_device(self) -> torch.device:
        if torch.cuda.is_available():
            worker_id = _get_nuclio_worker_id()
            device_index = worker_id % torch.cuda.device_count()
            device = torch.device(f"cuda:{device_index}")
            torch.cuda.set_device(device)
            print(f"RF-DETR+SAM worker {worker_id} using {device}", flush=True)
            return device
        return torch.device("cpu")

    def infer(
        self,
        image_base64: str,
        *,
        threshold: float | None = None,
        sam_embedding: str | None = None,
    ) -> list[dict[str, object]]:
        resolved_threshold = self._resolve_threshold(threshold)
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_array = np.array(image)
        height, width = image_array.shape[:2]

        body = self._call_upstream(image_bytes, resolved_threshold)

        if not body.get("ok", False):
            raise RuntimeError(f"RF-DETR upstream failed: {body.get('error', body)}")

        detections = self._extract_detections(body)
        results: list[dict[str, object]] = []
        if detections:
            if not self._set_cached_sam_embedding(image_array, sam_embedding):
                self.predictor.set_image(image_array)

        for detection in detections:
            score = float(detection.get("score", 0))
            if score < resolved_threshold:
                continue
            label = self._detection_label(detection)
            if label is None:
                continue

            box = detection.get("box") or {}
            x1 = max(0, min(width - 1, int(round(float(box["x1"])))))
            y1 = max(0, min(height - 1, int(round(float(box["y1"])))))
            x2 = max(0, min(width - 1, int(round(float(box["x2"])))))
            y2 = max(0, min(height - 1, int(round(float(box["y2"])))))
            if x2 <= x1 or y2 <= y1:
                continue

            masks, _sam_scores, _logits = self.predictor.predict(
                box=np.array([x1, y1, x2, y2]),
                multimask_output=False,
            )
            mask = (masks[0].astype(np.uint8) * 255)
            tight_box = _mask_tight_box(mask)
            if tight_box is None:
                continue

            cvat_mask = _to_cvat_mask(tight_box, mask)

            results.append(
                {
                    "confidence": f"{score:.6f}",
                    "label": label,
                    "mask": cvat_mask,
                    "type": "mask",
                }
            )

        return results

    def _resolve_threshold(self, threshold: float | None) -> float:
        requested_threshold = self.default_threshold if threshold is None else float(threshold)
        return max(self.min_threshold, requested_threshold)

    def _detection_label(self, detection: dict[str, object]) -> str | None:
        for key in ("classId", "class_id", "category_id"):
            if key not in detection:
                continue
            try:
                class_id = int(detection[key])
            except (TypeError, ValueError):
                continue
            if self.label_map:
                return self.label_map.get(class_id)

        label = detection.get("label")
        if isinstance(label, str) and label.strip():
            return label.strip()

        return self.label or None

    def _ordered_upstream_urls(self) -> list[str]:
        return self.upstream_urls[self.upstream_url_offset :] + self.upstream_urls[
            : self.upstream_url_offset
        ]

    def _call_upstream(self, image_bytes: bytes, threshold: float) -> dict[str, object]:
        errors = []
        for upstream_url in self._ordered_upstream_urls():
            body, boundary = self._multipart_body(image_bytes, threshold)
            request = urllib.request.Request(
                upstream_url,
                data=body,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                method="POST",
            )

            try:
                with self.opener.open(request, timeout=self.request_timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                errors.append(f"{upstream_url}: HTTP {exc.code}: {detail[:500]}")
            except urllib.error.URLError as exc:
                errors.append(f"{upstream_url}: {exc}")

        raise RuntimeError("Cannot reach RF-DETR upstreams: " + " | ".join(errors))

    def _set_cached_sam_embedding(self, image_array: np.ndarray, blob: str | None) -> bool:
        if not blob:
            return False

        height, width = image_array.shape[:2]
        try:
            raw = base64.b64decode(blob, validate=True)
            embedding = np.frombuffer(raw, dtype=np.float32)
            shape = _embedding_shape(embedding.size)
            if shape is None:
                raise ValueError(f"unexpected SAM embedding size: {embedding.size}")

            features = torch.from_numpy(embedding.copy().reshape(shape)).to(device=self.device)
            self.predictor.reset_image()
            self.predictor.features = features
            self.predictor.original_size = (height, width)
            self.predictor.input_size = self.predictor.transform.get_preprocess_shape(
                height,
                width,
                self.predictor.model.image_encoder.img_size,
            )
            self.predictor.is_image_set = True
            return True
        except Exception as exc:
            print(f"Cannot reuse cached SAM embedding, fallback to set_image: {exc}", flush=True)
            return False

    def _multipart_body(self, image_bytes: bytes, threshold: float) -> tuple[bytes, str]:
        boundary = f"----cvat-rfdetr-{uuid.uuid4().hex}"
        parts = [
            self._field(boundary, "threshold", str(threshold)),
            self._field(boundary, "filter_budspore", "true" if self.filter_budspore else "false"),
            self._field(boundary, "model_key", self.model_key),
            self._field(boundary, "client_ids", json.dumps(["cvat-frame"])),
            self._file(boundary, "files", "cvat-frame.jpg", "image/jpeg", image_bytes),
        ]
        closing = f"--{boundary}--\r\n".encode("utf-8")
        return b"".join(parts) + closing, boundary

    def _field(self, boundary: str, name: str, value: str) -> bytes:
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n"
        ).encode("utf-8")

    def _file(
        self,
        boundary: str,
        name: str,
        filename: str,
        content_type: str,
        data: bytes,
    ) -> bytes:
        header = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        return header + data + b"\r\n"

    def _extract_detections(self, body: dict[str, object]) -> list[dict[str, object]]:
        results = body.get("results") or []
        if not results:
            return []

        first_result = results[0]
        if not isinstance(first_result, dict):
            return []
        if first_result.get("status") == "error":
            raise RuntimeError(str(first_result.get("error") or "RF-DETR image inference failed"))

        model_results = first_result.get("modelResults")
        if isinstance(model_results, dict):
            selected = model_results.get(self.model_key)
            if isinstance(selected, dict):
                if selected.get("status") == "error":
                    raise RuntimeError(str(selected.get("error") or "RF-DETR model inference failed"))
                detections = selected.get("detections") or []
                return [item for item in detections if isinstance(item, dict)]

        detections = first_result.get("detections") or []
        return [
            item
            for item in detections
            if isinstance(item, dict) and item.get("modelKey", self.model_key) == self.model_key
        ]

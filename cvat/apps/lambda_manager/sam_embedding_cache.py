# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import base64
import binascii
import fcntl
import os
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from django.conf import settings

from cvat.apps.engine.log import ServerLogManager
from cvat.apps.engine.models import Task

slogger = ServerLogManager(__name__)

SAM_EMBEDDING_FUNCTION_ID = "pth-facebookresearch-sam-vit-h"
SAM_EMBEDDING_CACHE_DIRNAME = "sam_embeddings"
SAM_EMBEDDING_CACHE_MAX_BYTES = 20 * 1024 * 1024 * 1024
SAM_EMBEDDING_CACHE_MAX_AGE = timedelta(days=7)
SAM_EMBEDDING_CACHE_CLEANUP_INTERVAL = timedelta(minutes=1)


@dataclass(frozen=True)
class _CacheFile:
    path: Path
    size: int
    used_at: float


@contextmanager
def _nonblocking_cleanup_lock() -> Any:
    lock_path = settings.TASKS_ROOT / f".{SAM_EMBEDDING_CACHE_DIRNAME}.cleanup.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    with lock_path.open("w") as lock_file:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return

        try:
            yield True
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


class SAMEmbeddingCache:
    @classmethod
    def _cache_dir(cls, db_task: Task, *, function_id: str, version: int) -> Path:
        safe_function_id = function_id.replace("/", "_")
        return db_task.get_dirname() / SAM_EMBEDDING_CACHE_DIRNAME / safe_function_id / f"v{version}"

    @classmethod
    def _cache_path(cls, db_task: Task, frame: int, *, function_id: str, version: int) -> Path:
        return cls._cache_dir(db_task, function_id=function_id, version=version) / f"{frame}.bin"

    @classmethod
    def _touch(cls, path: Path) -> None:
        try:
            os.utime(path)
        except OSError:
            slogger.glob.warning("Failed to update SAM embedding cache access time", exc_info=True)

    @classmethod
    def load_blob(
        cls,
        db_task: Task,
        frame: int,
        *,
        function_id: str,
        version: int,
    ) -> str | None:
        path = cls._cache_path(db_task, frame, function_id=function_id, version=version)
        try:
            raw = path.read_bytes()
            cls._touch(path)
            return base64.b64encode(raw).decode("utf-8")
        except FileNotFoundError:
            return None
        except OSError:
            slogger.glob.warning(
                "Failed to read SAM embedding cache for task %s frame %s",
                db_task.id,
                frame,
                exc_info=True,
            )
            return None

    @classmethod
    def has(
        cls,
        db_task: Task,
        frame: int,
        *,
        function_id: str,
        version: int,
    ) -> bool:
        return cls._cache_path(
            db_task, frame, function_id=function_id, version=version
        ).is_file()

    @classmethod
    def store_blob(
        cls,
        db_task: Task,
        frame: int,
        blob: str,
        *,
        function_id: str,
        version: int,
    ) -> None:
        try:
            raw = base64.b64decode(blob, validate=True)
        except (binascii.Error, ValueError):
            slogger.glob.warning(
                "SAM embedding response for task %s frame %s is not valid base64",
                db_task.id,
                frame,
                exc_info=True,
            )
            return

        path = cls._cache_path(db_task, frame, function_id=function_id, version=version)
        path.parent.mkdir(parents=True, exist_ok=True)

        tmp_path = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            tmp_path.write_bytes(raw)
            os.replace(tmp_path, path)
            cls.maybe_cleanup(function_id=function_id)
        except OSError:
            slogger.glob.warning(
                "Failed to write SAM embedding cache for task %s frame %s",
                db_task.id,
                frame,
                exc_info=True,
            )
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

    @classmethod
    def store_response(
        cls,
        db_task: Task,
        frame: int,
        response: Any,
        *,
        function_id: str,
        version: int,
    ) -> None:
        if not isinstance(response, dict):
            return

        blob = response.get("blob")
        if isinstance(blob, str) and blob:
            cls.store_blob(db_task, frame, blob, function_id=function_id, version=version)

    @classmethod
    def _iter_cache_files(cls, *, function_id: str) -> list[_CacheFile]:
        safe_function_id = function_id.replace("/", "_")
        files: list[_CacheFile] = []

        for path in settings.TASKS_ROOT.glob(
            f"*/{SAM_EMBEDDING_CACHE_DIRNAME}/{safe_function_id}/v*/*.bin"
        ):
            try:
                stat = path.stat()
            except OSError:
                continue

            files.append(_CacheFile(path=path, size=stat.st_size, used_at=stat.st_mtime))

        return files

    @classmethod
    def _remove_file(cls, cache_file: _CacheFile) -> int:
        try:
            cache_file.path.unlink()
        except FileNotFoundError:
            return 0
        except OSError:
            slogger.glob.warning(
                "Failed to remove SAM embedding cache file %s",
                cache_file.path,
                exc_info=True,
            )
            return 0

        return cache_file.size

    @classmethod
    def _cleanup(cls, *, function_id: str) -> None:
        now = time.time()
        max_age_seconds = SAM_EMBEDDING_CACHE_MAX_AGE.total_seconds()
        live_files: list[_CacheFile] = []
        total_size = 0
        removed_count = 0
        removed_size = 0

        for cache_file in cls._iter_cache_files(function_id=function_id):
            if now - cache_file.used_at > max_age_seconds:
                removed = cls._remove_file(cache_file)
                if removed:
                    removed_size += removed
                    removed_count += 1
                continue

            live_files.append(cache_file)
            total_size += cache_file.size

        if total_size > SAM_EMBEDDING_CACHE_MAX_BYTES:
            for cache_file in sorted(live_files, key=lambda item: item.used_at):
                removed = cls._remove_file(cache_file)
                if not removed:
                    continue

                total_size -= removed
                removed_size += removed
                removed_count += 1

                if total_size <= SAM_EMBEDDING_CACHE_MAX_BYTES:
                    break

        if removed_count:
            slogger.glob.info(
                "Removed %s SAM embedding cache files, freed %s bytes",
                removed_count,
                removed_size,
            )

    @classmethod
    def maybe_cleanup(cls, *, function_id: str) -> None:
        stamp_path = settings.TASKS_ROOT / f".{SAM_EMBEDDING_CACHE_DIRNAME}.cleanup.stamp"

        try:
            last_cleanup = stamp_path.stat().st_mtime
        except FileNotFoundError:
            last_cleanup = 0
        except OSError:
            slogger.glob.warning("Failed to stat SAM embedding cleanup stamp", exc_info=True)
            last_cleanup = 0

        if time.time() - last_cleanup < SAM_EMBEDDING_CACHE_CLEANUP_INTERVAL.total_seconds():
            return

        with _nonblocking_cleanup_lock() as acquired:
            if not acquired:
                return

            try:
                cls._cleanup(function_id=function_id)
                stamp_path.touch()
            except Exception:
                slogger.glob.warning("Failed to cleanup SAM embedding cache", exc_info=True)

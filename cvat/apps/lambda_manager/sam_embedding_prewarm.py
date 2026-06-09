# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import base64
from datetime import timedelta

import django_rq
import rq
from django.conf import settings

from cvat.apps.engine.frame_provider import TaskFrameProvider
from cvat.apps.engine.log import ServerLogManager
from cvat.apps.engine.models import DimensionType, Task
from cvat.apps.engine.utils import get_rq_lock_for_job
from cvat.apps.lambda_manager.models import FunctionKind
from cvat.apps.lambda_manager.sam_embedding_cache import (
    SAM_EMBEDDING_FUNCTION_ID,
    SAMEmbeddingCache,
)

slogger = ServerLogManager(__name__)

_RESULT_TTL = timedelta(minutes=30)
_FAILED_TTL = timedelta(hours=3)


def _update_progress(progress: float) -> None:
    if rq_job := rq.get_current_job():
        rq_job.meta["progress"] = int(progress * 100)
        rq_job.save_meta()


def prewarm_sam_embeddings_for_task(
    task_id: int,
    *,
    function_id: str = SAM_EMBEDDING_FUNCTION_ID,
) -> None:
    from cvat.apps.lambda_manager.views import LambdaGateway

    db_task = Task.objects.select_related("data").get(pk=task_id)
    if db_task.dimension != DimensionType.DIM_2D:
        slogger.glob.info("Skip SAM embedding prewarm for non-2D task %s", task_id)
        return

    gateway = LambdaGateway()
    lambda_func = gateway.get(function_id)
    if lambda_func.kind != FunctionKind.INTERACTOR:
        slogger.glob.warning(
            "Skip SAM embedding prewarm for task %s: function %s is not an interactor",
            task_id,
            function_id,
        )
        return

    frame_provider = TaskFrameProvider(db_task)
    deleted_frames = set(db_task.data.deleted_frames)
    total = max(db_task.data.size, 1)

    try:
        for frame in range(db_task.data.size):
            if frame in deleted_frames:
                _update_progress((frame + 1) / total)
                continue

            if SAMEmbeddingCache.has(
                db_task,
                frame,
                function_id=lambda_func.id,
                version=lambda_func.version,
            ):
                _update_progress((frame + 1) / total)
                continue

            image = frame_provider.get_frame(frame)
            payload = {
                "image": base64.b64encode(image.data.getvalue()).decode("utf-8"),
            }
            response = lambda_func.gateway.invoke(lambda_func, payload)
            SAMEmbeddingCache.store_response(
                db_task,
                frame,
                response,
                function_id=lambda_func.id,
                version=lambda_func.version,
            )
            _update_progress((frame + 1) / total)
    finally:
        frame_provider.unload()


def enqueue_sam_embedding_prewarm_for_task(
    task_id: int,
    *,
    function_id: str = SAM_EMBEDDING_FUNCTION_ID,
) -> bool:
    queue = django_rq.get_queue(settings.CVAT_QUEUES.AUTO_ANNOTATION.value)
    rq_job_id = f"sam-embedding-prewarm-task-{task_id}-{function_id}"

    try:
        with get_rq_lock_for_job(queue, rq_job_id):
            rq_job = queue.fetch_job(rq_job_id)
            if rq_job and rq_job.get_status(refresh=False) not in {
                rq.job.JobStatus.FINISHED,
                rq.job.JobStatus.FAILED,
                rq.job.JobStatus.CANCELED,
            }:
                return False

            if rq_job:
                rq_job.delete()

            queue.enqueue(
                prewarm_sam_embeddings_for_task,
                args=(task_id,),
                kwargs={"function_id": function_id},
                job_id=rq_job_id,
                meta={
                    "task_id": task_id,
                    "function_id": function_id,
                    "progress": 0,
                },
                result_ttl=_RESULT_TTL.total_seconds(),
                failure_ttl=_FAILED_TTL.total_seconds(),
            )
            return True
    except Exception:
        slogger.glob.warning(
            "Failed to enqueue SAM embedding prewarm for task %s",
            task_id,
            exc_info=True,
        )
        return False

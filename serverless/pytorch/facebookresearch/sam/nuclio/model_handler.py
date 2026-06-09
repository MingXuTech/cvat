# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

import numpy as np
import sys
import torch
from segment_anything import sam_model_registry, SamPredictor


def _get_nuclio_worker_id():
    for index, arg in enumerate(sys.argv):
        if arg == "--worker-id" and index + 1 < len(sys.argv):
            return int(sys.argv[index + 1])
        if arg.startswith("--worker-id="):
            return int(arg.split("=", 1)[1])

    return 0


class ModelHandler:
    def __init__(self):
        if torch.cuda.is_available():
            worker_id = _get_nuclio_worker_id()
            device_index = worker_id % torch.cuda.device_count()
            self.device = torch.device(f"cuda:{device_index}")
            torch.cuda.set_device(self.device)
            print(f"SAM worker {worker_id} using {self.device}", flush=True)
        else:
            self.device = torch.device("cpu")

        self.sam_checkpoint = "/opt/nuclio/sam/sam_vit_h_4b8939.pth"
        self.model_type = "vit_h"
        self.latest_image = None
        sam_model = sam_model_registry[self.model_type](checkpoint=self.sam_checkpoint)
        sam_model.to(device=self.device)
        self.predictor = SamPredictor(sam_model)

    def handle(self, image):
        self.predictor.set_image(np.array(image))
        features = self.predictor.get_image_embedding()
        return features

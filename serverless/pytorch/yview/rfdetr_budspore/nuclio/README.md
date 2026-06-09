# RF-DETR Budspore CVAT Nuclio Detector

This function registers the local RF-DETR budspore model as a CVAT `detector`.
It calls the existing RF-DETR HTTP service at `http://172.20.2.148:8787/api/detect`,
then refines each detected box with SAM.

The function returns CVAT mask detections for label `芽孢`.

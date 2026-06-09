# CountGD CVAT Nuclio Detector

This package deploys CountGD into CVAT as a lightweight `detector`-type Nuclio function.

Important limitation:

- CVAT detector auto-annotation does not send exemplar clicks to the model.
- This function therefore uses fixed exemplars configured in environment variables.
- The Nuclio container forwards each frame to a running CountGD upstream service.

Configuration before deployment:

- Make sure the CountGD web service is running and reachable from Docker.
- Set `COUNTGD_UPSTREAM_URL`, in this host currently `http://172.20.2.148:8000/api/count_image`.
- Set `COUNTGD_EXEMPLAR_POINTS` to one or more exemplar centers.
- Or set `COUNTGD_EXEMPLAR_BOXES` to one or more exemplar boxes.
- `COUNTGD_CAPTION` controls the text prompt.

Examples:

```yaml
- name: COUNTGD_UPSTREAM_URL
  value: http://172.20.2.148:8000/api/count_image
- name: COUNTGD_CAPTION
  value: spore
- name: COUNTGD_EXEMPLAR_POINTS
  value: "930,190;860,620"
```

```yaml
- name: COUNTGD_EXEMPLAR_BOXES
  value: "[[900, 170, 960, 230], [830, 590, 890, 650]]"
```

# Kling V1 Capabilities Matrix

| Capability                  | Supported I2V? | Supported T2V? | Exact Request Field      | Allowed Values            | Required? | Default | Cost Implications                         |
|-----------------------------|----------------|----------------|--------------------------|---------------------------|-----------|---------|-------------------------------------------|
| Provider Quality Preset     | YES            | YES            | `settings.resolution`    | `"720p"`, `"1080p"`       | Optional  | `"720p"`| 1080p costs significantly more than 720p. |
| Duration                    | YES            | YES            | `settings.duration`      | `5`, `10`                 | Optional  | `5`     | 10s costs 2x the 5s baseline.             |
| Aspect Ratio / Proportions  | NO             | YES            | `settings.aspect_ratio`  | `"16:9"`, `"9:16"`, `"1:1"`| Optional  | `"16:9"`| None inherently.                          |
| Audio Generation            | YES            | YES            | `settings.audio`         | `"off"`, `"on"`           | Optional  | `"off"` | May cost extra units (e.g. +1 unit).      |
| Multi-shot                  | YES            | YES            | `settings.multi_shot`    | `false`, `true`           | Optional  | `false` | Usually same cost, affects scene variety. |
| Watermark                   | YES            | YES            | `options.watermark_info` | `{ enabled: false }`      | Optional  | `false` | None. Remains fixed OFF.                  |

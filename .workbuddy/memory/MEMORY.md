
## 本地 S3 数据库
- 位置：`船舶反欺诈/本地S3数据库/`（upload/ download/ root/ + manifest.json + README.md），49 个真实文件，离线调试用。
- 刷新方式：内网环境下 `cd s3-file-manager/server && node fetch_s3_samples.mjs`。
- S3 有两种文件格式：船舶（2026，6/17 列）与企业 A01_（2024-25，4/18 列）；命名脏数据多（大写 _RESULT、空格、双后缀、错放目录），README 中有边界样例清单。

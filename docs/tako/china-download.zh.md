# 国内下载通道

[English](china-download.md) | 中文

每个已发布的版本都由 [release.yml](../../.github/workflows/release.yml) 中的 `china-mirror` 任务镜像到阿里云 OSS `dsh-tako-dl`（华东2·上海，公共读）。下载页和更新源如需国内可达的地址，应消费 `latest.json` 清单，而不是自行拼接 URL。

## latest.json 契约

请求 `https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/latest.json`。它在每次版本的 OSS 上传完成后被原子重写，因此始终描述国内镜像已完整的最新版本。

```json
{
  "tag": "v0.1.51",
  "version": "0.1.51",
  "githubReleaseUrl": "https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.51",
  "sources": {
    "oss":    { "label": "cn",     "baseUrl": "https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/releases/v0.1.51" },
    "github": { "label": "global", "baseUrl": "https://github.com/tako-dev/dsh-tako-desktop/releases/download/v0.1.51" }
  },
  "assets": [
    {
      "name": "DSH-Tako-0.1.51-mac-arm64.dmg",
      "role": "mac-arm64",
      "ossUrl": "https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/releases/v0.1.51/DSH-Tako-0.1.51-mac-arm64.dmg",
      "githubUrl": "https://github.com/tako-dev/dsh-tako-desktop/releases/download/v0.1.51/DSH-Tako-0.1.51-mac-arm64.dmg",
      "sha256": "59292438…",
      "size": 259458569
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `tag` / `version` | 被镜像版本的 Git tag 与裸版本号 |
| `sources.oss.baseUrl` | 该 tag 的 OSS 前缀；直链 = `baseUrl/<asset name>` |
| `sources.github.baseUrl` | GitHub `releases/download/<tag>` 前缀 |
| `assets[].role` | `mac-arm64`、`win-x64`，或辅助文件为 `null` |
| `assets[].ossUrl` / `githubUrl` | 各通道的直链下载地址 |
| `assets[].sha256` | 取自 `SHA256SUMS.txt` 的 SHA-256；校验和文件本身为 `null` |
| `assets[].size` | 字节数；OSS 保存同一对象，`Content-Length` 一致 |

消费方应对国内用户选用 `ossUrl`、其他用户选用 `githubUrl`，两者可互为回退。`role` 标识各系统安装包；`role: null` 的文件（`.zip`、`.blockmap`、`latest*.yml`、`SHA256SUMS.txt`）是更新元数据或备用格式，同样镜像在该前缀下。

## OSS 上的目录布局

- `releases/<tag>/<asset name>` — GitHub Release 中的每个文件，字节一致（先在镜像机上按 `SHA256SUMS.txt` 校验，再按大小做 HEAD 校验；流水线的 verify 步骤还要求 `latest.json` 恰好列出本次 Release 的 `SHA256SUMS.txt` 条目且哈希一致，并重查每个 `ossUrl`）。
- `latest.json` — 上述清单。旧版本保留在 `releases/` 下；清单始终指向最新版本。若远端清单已指向更新版本，同步会拒绝回写，除非显式加 `--force-older`，因此重跑旧 tag 的流水线不会静默回退下载通道。

## 运维

- 上传由大陆镜像机上的 `dsh-dl` 用户经 `/usr/local/bin/dsh-oss-sync.py`（源码 `apps/desktop/scripts/dsh-oss-sync.py`）执行，由 `china-mirror` 在 `dsh-dl` 镜像同步完成后通过 SSH 触发。凭据只存在该机器的 `/etc/dsh-dl-oss.env`（`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`，`dsh-dl` 组可读）；GitHub 仓库不保存任何 OSS 密钥。
- 上传前 job 会比对宿主机脚本与本次 tag 的 `apps/desktop/scripts/dsh-oss-sync.py`，不一致即失败，旧副本无法继续驱动通道；修改该脚本后，打 tag 前需把它装到宿主机 `/usr/local/bin/dsh-oss-sync.py`（0755）。
- 桶 ACL 为 `public-read`；桶级 `PublicAccessBlock` 已关闭。OSS 直链不需要签名。
- `dsh-dl.shiroha.tech` 继续用镜像机自有 TLS 提供同一批文件；OSS 是 `latest.json` 中稳定可寻址的国内源。
- 上传集合取自本次版本的 `SHA256SUMS.txt`，而非目录扫描——镜像目录会保留旧版本文件，只有本次版本的文件属于 `releases/<tag>/` 前缀和清单。
- 漏同步时可手动补：`ssh dsh-dl@<host> '/usr/local/bin/dsh-oss-sync.py --tag vX.Y.Z'`（幂等；大小已一致的对象会跳过）。仅当要把通道回退到旧 tag 时才加 `--force-older`——默认拒绝把 `latest.json` 回退到旧版本，`workflow_dispatch` 提供同样的放行开关。

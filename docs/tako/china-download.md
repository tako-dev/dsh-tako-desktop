# China download channel

English | [中文](china-download.zh.md)

Every published release is mirrored to Aliyun OSS `dsh-tako-dl` (cn-shanghai, public-read) by the `china-mirror` job in [release.yml](../../.github/workflows/release.yml). Download pages and update feeds that need a mainland-friendly source should consume the `latest.json` manifest instead of guessing URLs.

## latest.json contract

Fetch `https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/latest.json`. It is rewritten atomically after each release's OSS upload finishes, so it always describes the newest release that has a complete China mirror.

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

| Field | Meaning |
|---|---|
| `tag` / `version` | Git tag and bare version of the mirrored release |
| `sources.oss.baseUrl` | OSS prefix for this tag; direct link = `baseUrl/<asset name>` |
| `sources.github.baseUrl` | GitHub `releases/download/<tag>` prefix |
| `assets[].role` | `mac-arm64`, `win-x64`, or `null` for support files |
| `assets[].ossUrl` / `githubUrl` | Direct download for each channel |
| `assets[].sha256` | SHA-256 from `SHA256SUMS.txt`; `null` for the checksums file itself |
| `assets[].size` | Bytes; OSS serves the same object, so `Content-Length` matches |

Consumers should pick `ossUrl` for China users and `githubUrl` otherwise, and may fall back between them. `role` identifies the per-OS installer; assets with `role: null` (`.zip`, `.blockmap`, `stable*.yml`/`latest*.yml`, `SHA256SUMS.txt`) are updater metadata or alternate formats, mirrored at the same prefix.

## Layout on OSS

- `releases/<tag>/<asset name>` — every file in the GitHub Release, byte-identical (verified against `SHA256SUMS.txt` on the mirror host, then HEAD-checked against size after upload; the workflow's verify step then requires `latest.json` to list exactly the release's `SHA256SUMS.txt` entries with matching hashes and HEAD-checks every `ossUrl`).
- `latest.json` — the manifest above. Older tags stay under `releases/`; the manifest always names the latest. The sync refuses to overwrite a manifest that names a newer version unless `--force-older` is passed, so re-running an old tag's workflow cannot silently regress the channel.

## Operation

- Uploads run on the mainland mirror host as user `dsh-dl` via `/usr/local/bin/dsh-oss-sync.py` (source: `apps/desktop/scripts/dsh-oss-sync.py`), invoked by `china-mirror` over SSH after the `dsh-dl` mirror sync. Credentials live only on that host in `/etc/dsh-dl-oss.env` (`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`, group-readable by `dsh-dl`); no OSS secret is stored in the GitHub repository.
- The job fails before uploading unless the host's script matches the released tag's `apps/desktop/scripts/dsh-oss-sync.py`, so a stale install cannot drive the channel; after changing that script, install it at `/usr/local/bin/dsh-oss-sync.py` (0755) on the host before tagging.
- The bucket ACL is `public-read`; `PublicAccessBlock` is disabled on the bucket. OSS direct links require no signature.
- `dsh-dl.shiroha.tech` continues to serve the same files over the mirror's own TLS; OSS is the durable, addressable China source in `latest.json`.
- The upload set comes from this release's `SHA256SUMS.txt`, not a directory listing — the mirror directory keeps files from older releases, and only this release's files belong under `releases/<tag>/` and in the manifest.
- Re-run manually when a sync is missed: `ssh dsh-dl@<host> '/usr/local/bin/dsh-oss-sync.py --tag vX.Y.Z'` (idempotent; skips objects whose size already matches). Add `--force-older` only to roll the channel back to an older tag — the default refuses to downgrade `latest.json`, and `workflow_dispatch` exposes the same override.

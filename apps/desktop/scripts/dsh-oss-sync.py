#!/usr/bin/env python3
"""Sync the dsh-dl mirror to Aliyun OSS and publish latest.json.

Runs on the mainland download host (dsh-dl user). Uploads every installer
asset already mirrored under DATA_DIR to oss://dsh-tako-dl/releases/<tag>/,
then rewrites DATA_DIR/latest.json with the dual-source contract described in
docs/tako/china-download.md. Credentials come from /etc/dsh-dl-oss.env
(OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET, group-readable by dsh-dl).

Installed at /usr/local/bin/dsh-oss-sync.py; invoked by the release workflow's
china-mirror job over SSH after the mirror sync. Usage: dsh-oss-sync.py --tag vX.Y.Z
"""
import argparse, email.utils, hashlib, hmac, base64, http.client, json, os, ssl, sys, urllib.parse

BUCKET = "dsh-tako-dl"
REGION = "oss-cn-shanghai"
DATA_DIR = "/srv/dsh-dl/data"
ENV_FILE = "/etc/dsh-dl-oss.env"
EXTERNAL = f"https://{BUCKET}.{REGION}.aliyuncs.com"
INTERNAL = f"https://{BUCKET}.{REGION}-internal.aliyuncs.com"
GITHUB_DL = "https://github.com/tako-dev/dsh-tako-desktop/releases/download"

EXCLUDE = ("dmg.url", "latest.json")
METADATA = ("latest.yml", "latest-mac.yml", "SHA256SUMS.txt")
ASSET_ROLES = {
    "mac-arm64.dmg": "mac-arm64",
    "win-x64.exe": "win-x64",
}


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def sign_v1(sk, verb, resource, ctype=""):
    date = email.utils.formatdate(usegmt=True)
    to_sign = "\n".join([verb, "", ctype, date]) + "\n" + resource
    return base64.b64encode(
        hmac.new(sk.encode(), to_sign.encode(), hashlib.sha1).digest()
    ).decode(), date


class OssClient:
    def __init__(self, ak, sk, host):
        self.ak, self.sk = ak, sk
        self.host = urllib.parse.urlparse(host).netloc

    def request(self, verb, key, body=None, ctype="", timeout=300):
        conn = http.client.HTTPSConnection(self.host, timeout=timeout, context=ssl.create_default_context())
        resource = f"/{BUCKET}/{key}"
        sig, date = sign_v1(self.sk, verb, resource, ctype)
        headers = {"Date": date, "Authorization": f"OSS {self.ak}:{sig}"}
        if ctype:
            headers["Content-Type"] = ctype
        if body is not None and hasattr(body, "read"):
            headers["Content-Length"] = str(os.fstat(body.fileno()).st_size)
            src = body
            chunks = iter(lambda: src.read(1024 * 1024), b"")
            conn.request(verb, f"/{key}", body=chunks, headers=headers, encode_chunked=False)
        else:
            conn.request(verb, f"/{key}", body=body, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, dict(resp.getheaders()), data


def read_tag(data_dir, explicit):
    if explicit:
        return explicit
    for name in ("latest.yml", "latest-mac.yml"):
        for line in open(os.path.join(data_dir, name)):
            if line.startswith("version:"):
                return "v" + line.split(":", 1)[1].strip()
    raise SystemExit("cannot determine tag: pass --tag")


def read_sha256_map(data_dir):
    out = {}
    with open(os.path.join(data_dir, "SHA256SUMS.txt")) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2:
                out[parts[1]] = parts[0]
    return out


def list_uploads(data_dir):
    names = sorted(os.listdir(data_dir))
    return [n for n in names
            if n not in EXCLUDE and not os.path.isdir(os.path.join(data_dir, n))]


def content_type(name):
    if name.endswith(".blockmap"):
        return "application/octet-stream"
    if name.endswith((".dmg", ".zip", ".exe")):
        return "application/octet-stream"
    if name.endswith(".yml"):
        return "text/yaml"
    if name.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default=None, help="release tag, e.g. v0.1.51")
    ap.add_argument("--external", action="store_true", help="use public endpoint instead of internal")
    args = ap.parse_args()

    env = load_env(ENV_FILE)
    ak, sk = env["OSS_ACCESS_KEY_ID"], env["OSS_ACCESS_KEY_SECRET"]
    base = EXTERNAL if args.external else INTERNAL
    client = OssClient(ak, sk, base)

    tag = read_tag(DATA_DIR, args.tag)
    version = tag.lstrip("v")
    sha = read_sha256_map(DATA_DIR)
    prefix = f"releases/{tag}/"

    uploaded = []
    for name in list_uploads(DATA_DIR):
        key = prefix + name
        st, h, b = client.request("HEAD", key)
        expected = sha.get(name)
        size = os.path.getsize(os.path.join(DATA_DIR, name))
        if st == 200 and int(h.get("Content-Length", -1)) == size:
            print(f"skip {name} (already uploaded, {size} B)")
        else:
            print(f"put {name} ({size} B) -> {key}")
            with open(os.path.join(DATA_DIR, name), "rb") as f:
                st, h, b = client.request("PUT", key, body=f, ctype=content_type(name))
            if st != 200:
                print(f"FAILED put {name}: {st} {b[:300]}", file=sys.stderr)
                sys.exit(1)
            st, h, b = client.request("HEAD", key)
            if st != 200 or int(h.get("Content-Length", -1)) != size:
                print(f"FAILED verify {name}: {st} {h.get('Content-Length')}", file=sys.stderr)
                sys.exit(1)
        role = next((r for suf, r in ASSET_ROLES.items() if name.endswith(suf)), None)
        uploaded.append({
            "name": name, "role": role,
            "ossUrl": f"{EXTERNAL}/{key}",
            "githubUrl": f"{GITHUB_DL}/{tag}/{name}",
            "sha256": expected, "size": size,
        })

    manifest = {
        "tag": tag,
        "version": version,
        "githubReleaseUrl": f"https://github.com/tako-dev/dsh-tako-desktop/releases/tag/{tag}",
        "sources": {
            "oss": {"label": "cn", "baseUrl": f"{EXTERNAL}/releases/{tag}"},
            "github": {"label": "global", "baseUrl": f"{GITHUB_DL}/{tag}"},
        },
        "assets": uploaded,
        "generatedBy": "dsh-oss-sync.py",
    }
    raw = json.dumps(manifest, indent=2, ensure_ascii=False).encode() + b"\n"
    st, h, b = client.request("PUT", "latest.json", body=raw, ctype="application/json")
    if st != 200:
        print(f"FAILED put latest.json: {st} {b[:300]}", file=sys.stderr)
        sys.exit(1)
    with open(os.path.join(DATA_DIR, "latest.json"), "wb") as f:
        f.write(raw)
    print(f"done: {len(uploaded)} assets under {prefix}; latest.json updated")


if __name__ == "__main__":
    main()

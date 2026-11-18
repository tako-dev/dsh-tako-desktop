#!/usr/bin/env python3
"""Verify the OSS channel and the dual-source latest.json contract.

Runs in the release workflow's china-mirror job after dsh-oss-sync.py has
published the manifest. Fetches https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/
latest.json and fails unless its tag matches the release, both source base URLs
point at that tag, and every asset's OSS direct link returns 200 with the
recorded size. Contract: docs/tako/china-download.md.

Usage: dsh-oss-verify.py --tag vX.Y.Z
"""
import argparse, json, sys, urllib.request

LATEST_URL = "https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/latest.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True, help="release tag, e.g. v0.1.51")
    args = ap.parse_args()

    with urllib.request.urlopen(LATEST_URL, timeout=30) as resp:
        manifest = json.loads(resp.read())

    tag = args.tag
    assert manifest["tag"] == tag, (manifest["tag"], tag)
    assert manifest["version"] == tag.lstrip("v"), manifest["version"]
    assert manifest["sources"]["oss"]["baseUrl"].endswith("/releases/" + tag)
    assert manifest["sources"]["github"]["baseUrl"].endswith("/download/" + tag)
    assert manifest["assets"], "no assets"

    for asset in manifest["assets"]:
        req = urllib.request.Request(asset["ossUrl"], method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as resp:
            assert resp.status == 200, (asset["name"], resp.status)
            assert int(resp.headers["Content-Length"]) == asset["size"], asset["name"]
        print(f"oss ok: {asset['name']} {asset['size']} B")
    print(f"latest.json contract verified for {tag} ({len(manifest['assets'])} assets)")


if __name__ == "__main__":
    main()

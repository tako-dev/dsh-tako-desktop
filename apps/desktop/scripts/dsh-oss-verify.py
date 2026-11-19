#!/usr/bin/env python3
"""Verify the OSS channel and the dual-source latest.json contract.

Runs in the release workflow's china-mirror job after dsh-oss-sync.py has
published the manifest. Fetches https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/
latest.json and fails unless its tag matches the release, both source base URLs
point at that tag, its assets are exactly the release's SHA256SUMS.txt entries
with matching checksums, and every asset's OSS direct link returns 200 with the
recorded size. Contract: docs/tako/china-download.md.

Usage: dsh-oss-verify.py --tag vX.Y.Z
"""
import argparse, json, sys, urllib.request

LATEST_URL = "https://dsh-tako-dl.oss-cn-shanghai.aliyuncs.com/latest.json"
SUMS_URL = ("https://github.com/tako-dev/dsh-tako-desktop"
            "/releases/download/{tag}/SHA256SUMS.txt")


def release_checksums(tag):
    """Return {file name: sha256} from the tag's GitHub release, plus the checksums file mapped to None."""
    with urllib.request.urlopen(SUMS_URL.format(tag=tag), timeout=30) as resp:
        text = resp.read().decode()
    sums = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if len(parts) != 2:
            raise SystemExit(f"malformed SHA256SUMS.txt line for {tag}: {line!r}")
        sums[parts[1]] = parts[0]
    if not sums:
        raise SystemExit(f"empty SHA256SUMS.txt for {tag}")
    sums["SHA256SUMS.txt"] = None
    return sums


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

    # The manifest must describe exactly this release's files with this release's
    # checksums. The mirror directory keeps earlier releases' files, so a
    # directory-driven upload set would surface here as stale assets with null
    # checksums, duplicate installer roles, and links that 404 on GitHub.
    expected = release_checksums(tag)
    names = [asset["name"] for asset in manifest["assets"]]
    assert len(names) == len(set(names)), f"duplicate asset names: {sorted(names)}"
    assert set(names) == set(expected), (
        f"manifest/release mismatch: extra={sorted(set(names) - set(expected))} "
        f"missing={sorted(set(expected) - set(names))}")
    roles = [asset["role"] for asset in manifest["assets"] if asset["role"] is not None]
    assert len(roles) == len(set(roles)), f"duplicate installer roles: {sorted(roles)}"
    for asset in manifest["assets"]:
        assert asset["sha256"] == expected[asset["name"]], asset["name"]

    for asset in manifest["assets"]:
        req = urllib.request.Request(asset["ossUrl"], method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as resp:
            assert resp.status == 200, (asset["name"], resp.status)
            assert int(resp.headers["Content-Length"]) == asset["size"], asset["name"]
        print(f"oss ok: {asset['name']} {asset['size']} B")
    print(f"latest.json contract verified for {tag} ({len(manifest['assets'])} assets)")


if __name__ == "__main__":
    main()

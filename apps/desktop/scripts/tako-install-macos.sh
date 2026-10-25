#!/bin/sh
# Tako's one-line macOS bootstrap. The downloaded Desktop artifact already
# contains the signed DSH + Tako runtime package set; this script does not
# install an unverified plugin into an existing profile.
set -eu

manifest_url=${1:-${TAKO_RELEASE_MANIFEST_URL:-}}
if [ -z "$manifest_url" ]; then
  echo "Usage: TAKO_RELEASE_MANIFEST_URL=https://.../tako-release.json sh tako-install-macos.sh" >&2
  exit 2
fi
case "$manifest_url" in
  https://*) ;;
  *) echo "Tako release manifest must use HTTPS" >&2; exit 2 ;;
esac

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/tako-install.XXXXXX")
mount_root="$tmp_root/mount"
mkdir -p "$mount_root"
cleanup() {
  if mount | grep -Fq " on $mount_root "; then hdiutil detach "$mount_root" -quiet || true; fi
  rm -rf "$tmp_root"
}
trap cleanup EXIT INT TERM

manifest="$tmp_root/manifest.json"
echo "[tako] downloading release manifest"
curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$manifest_url" -o "$manifest"

platform=$(uname -m | awk '{ if ($1 == "arm64") print "macos-arm64"; else if ($1 == "x86_64") print "macos-x64"; else exit 1 }') || {
  echo "[tako] unsupported macOS architecture: $(uname -m)" >&2
  exit 1
}

# Python is used only to read JSON; no credentials or network calls enter it.
artifact_rows=$(python3 - "$manifest" "$platform" <<'PY'
import json, sys
from urllib.parse import urlparse
data = json.load(open(sys.argv[1], encoding='utf-8'))
if data.get('schemaVersion') != 1 or not data.get('dshVersion') or not data.get('bundleVersion'):
    raise SystemExit('invalid Tako release manifest')
if data.get('bundle', {}).get('packageName') != '@deepseek-ai/dsh-tako':
    raise SystemExit('release manifest is not a Tako bundle')
if data['bundle'].get('version') != data['bundleVersion']:
    raise SystemExit('Tako bundle version does not match the release manifest')
for channel in ('domestic', 'overseas'):
    artifact = data['artifacts'][sys.argv[2]][channel]
    url = artifact['url']
    if urlparse(url).scheme != 'https' or len(artifact.get('sha256', '')) != 64:
        raise SystemExit('release artifact must have an HTTPS URL and SHA-256')
    print(f"{channel}\t{url}\t{artifact['sha256'].lower()}")
PY
)

artifact="$tmp_root/desktop.dmg"
selected=''
printf '%s\n' "$artifact_rows" | while IFS="$(printf '\t')" read -r channel url expected; do
  [ -n "$url" ] || continue
  echo "[tako] trying $channel CDN"
  candidate="$artifact.$channel"
  if curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$url" -o "$candidate" \
    && actual=$(shasum -a 256 "$candidate" | awk '{print $1}') \
    && [ "$actual" = "$expected" ]; then
    mv "$candidate" "$artifact"
    printf '%s\n' "$channel" > "$tmp_root/channel"
    break
  fi
  rm -f "$candidate"
done
if [ ! -s "$artifact" ]; then
  echo "[tako] no CDN artifact passed download and SHA-256 verification" >&2
  exit 1
fi

echo "[tako] mounting verified Desktop"
hdiutil attach "$artifact" -nobrowse -readonly -mountpoint "$mount_root" -quiet
app_source=$(find "$mount_root" -type d -name '*.app' -print -quit)
if [ -z "$app_source" ]; then
  echo "[tako] verified DMG does not contain an application bundle" >&2
  exit 1
fi
install_root=${TAKO_INSTALL_ROOT:-/Applications}
mkdir -p "$install_root"
app_target="$install_root/$(basename "$app_source")"
echo "[tako] installing $app_target"
rm -rf "$app_target"
ditto "$app_source" "$app_target"
hdiutil detach "$mount_root" -quiet
echo "[tako] starting Tako Desktop"
open "$app_target"

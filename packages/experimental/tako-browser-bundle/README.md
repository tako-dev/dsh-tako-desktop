---
description: "Preinstalled Tako Agent browser tools with an isolated Chromium profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-tako-browser-bundle

English | [中文](README.zh.md)

## Summary

The Tako profile ships with Agent browser tools enabled. Each Agent gets its own persistent Chromium profile by default. On Desktop, the user can choose **Share with Agent** in the Browser tab; `desktop_browser` then operates that same live tab and login state. **Stop sharing** or closing the tab revokes access without clearing browser storage.

The browser layer is optional to the DSH core. If Chromium cannot be started or downloaded, Tako text, image, speech, and search capabilities remain available and the browser can be retried later.

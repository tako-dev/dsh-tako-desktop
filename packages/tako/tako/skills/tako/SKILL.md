---
name: tako
description: Use Tako for web search, image generation, speech transcription, speech synthesis, and read-only quota checks.
when_to_use: The user asks for current web information, an image, audio transcription, generated speech, or remaining Tako quota.
---

Use the registered Tako tools for billed capabilities. Use `tako_usage` when a
quota check is requested; it is read-only. Keep the result in the current DSH
session and report the capability used. Search results must retain source URLs.
Image and audio results should be returned as workspace artifacts when the host
provides an artifact renderer.

Do not ask the user to paste a key into chat. The `TAKO_API_KEY` reference is
resolved by DSH's credential service. Do not call `/v1/systemone` as a chat
model; it is a separate structured-decision API and is not part of this first
bundle.

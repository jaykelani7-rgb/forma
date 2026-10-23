# Gemini implementation references — checked 21 October 2026

These references describe the implemented production adapter. No live provider calls were made to validate account access, teaching quality, transcription accuracy or speech performance.

## Defaults and capabilities

New local installations choose Gemini. The default text and transcription model is `gemini-3.8-flash`; speech uses `gemini-3.8-flash-tts`. Text/audio model IDs are independently configurable in Setup → Advanced model settings or host environment variables. Existing saved OpenAI configuration remains OpenAI. The [Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) lists audio input and text output; speech generation uses a separate [TTS model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts).

`geminiCapabilities` is a small local compatibility check, not account/model discovery. It enables transcription for recognized Gemini 3.6/3.8 Flash/Pro family IDs and speech for the documented 3.8 Flash/Flash-Lite TTS IDs. Incompatible voice configuration disables that control with an explanation while text stays available. Unknown model access is reported by the API when the user explicitly sends; the app never probes credentials or falls back to a different provider.

## Text transport

The host sends one HTTPS POST to `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`, authenticating with `x-goog-api-key` rather than a query-string key. It maps assistant history to `model` and user history to `user`, supplies the existing tutor policy as `systemInstruction`, sends no tools, and sets `store:false`. The parser accepts bounded UTF-8 SSE frames, hides thought parts, retains visible partial text, requires a nonempty answer with final `STOP`, maps refusals, and reads actual `usageMetadata` / `modelVersion`. It does not synthesize token counts. Request/response/model provenance remains separate from original frozen context. See [GenerateContent REST reference](https://ai.google.dev/api/generate-content) and [text generation](https://ai.google.dev/gemini-api/docs/text-generation).

## Recorded transcription

The adapter uses `POST /v1beta/interactions` with the selected transcription model, `store:false`, an explicit transcription-only instruction and inline base64 audio. It reads completed `model_output` text from `steps`; it never treats the recording as an instruction to answer or send a chat message. WebM/Opus is preferred by the recorder. Supported input MIME types are checked; MPEG-4 recorder output is labelled M4A for this API. Empty, oversized or unreadable results fail explicitly. The app keeps its 60-second/8-MiB recording bound, avoids the persistent Files API, and returns transcription only to the original editable composer. References: [audio understanding](https://ai.google.dev/gemini-api/docs/audio), [Interactions request/response and audio content schemas](https://ai.google.dev/api/interactions-api).

## Spoken replies and formats

The same Interactions endpoint receives the selected TTS model, text-only `user_input`, a calm `speech_metadata` annotation, a fixed prebuilt `Kore` voice and requested `audio/wav` at 24 kHz. Completed model output audio is decoded and validated. WAV already contains its RIFF header and is never wrapped twice. Explicit raw L16/PCM output is wrapped as mono signed 16-bit little-endian WAV using declared sample-rate metadata (24 kHz by documented default). Conflicting formats/rates, invalid base64, empty audio, stereo or malformed containers are rejected. Browser playback receives a supported MIME/container and releases its object URL and audio resource when finished/cancelled. See [official TTS generation and output formats](https://ai.google.dev/gemini-api/docs/speech-generation).

## Errors, cancellation and privacy

Shared typed errors distinguish setup, credentials, permissions, configuration, unavailable model/capability, rate/quota, timeout, network, service, refusal, malformed output and cancellation. Adapters inspect bounded structured error codes/reasons and HTTP status, without exposing response bodies or request text. A generic 400 means invalid request/configuration; 403 means permission unless a documented structured credential/refusal code says otherwise. References: [Gemini error codes](https://ai.google.dev/gemini-api/docs/api-errors), [troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes).

Direct `fetch` uses an AbortSignal, a fixed HTTPS origin, `redirect:error`, absolute deadline and bounded readers. There are no SDK retry defaults, polling jobs or automatic paid retries. Stop, provider switching, leaving a voice interaction and app shutdown abort outstanding work and reject late results; cancellation cannot guarantee that a provider has not already processed/billed a dispatched request. Raw recordings/playback bytes are ephemeral. `store:false` requests do not imply provider-side zero retention or override the selected account's data-processing terms.

See [setup, migrations, context controls, privacy and the deferred live walkthrough](tutor.md).

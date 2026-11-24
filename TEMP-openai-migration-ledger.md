# OpenAI API Migration Decision Ledger

Application: Life Letters survey. Implementation authorized by “id like it to switch to OpenAi.”
Credential decision: user selected “Create a new key securely”; OpenAI Developers connected. Secure Platform picker opened; selected organization/project and local destination remain pending. No credential values belong in this ledger.

Current stage: migrate both existing phonics request paths together, test, publish through GitHub, deploy to the existing Render service, and verify live when a key is available. User already authorized provider replacement and deployment. No separate harness or agent changes are proposed.

| Area reviewed | Applicability / support | Decision and evidence |
|---|---|---|
| Model selection | Both short interactive classification paths; supported | GPT-6 Luna preserves the efficient Haiku workload role. Current official model page confirms Responses, structured outputs and low reasoning; account access remains to be checked with the new key. |
| Instruction-file naming | No instruction files involved | No compatibility file or rename needed. |
| Responses migration: single word | Applicable, supported | Replace Anthropic Messages with OpenAI Responses, retaining phonics instructions and `{valid,emoji,message,suggestion}` HTTP result. |
| Responses migration: validate all | Applicable, supported | One synchronous Responses call for custom entries, strict requested-letter schema, reviewed examples merged locally. This is not the asynchronous Batch API. |
| Provider / framework choice | Explicitly authorized replacement | Direct OpenAI SDK replaces the direct Anthropic SDK. Same HTTP transport and frontend contract; provider-specific request fields are translated. No legacy provider retained because the user requested a switch. |
| Streaming | No existing streaming; complete verdict needed | Not applicable to the atomic JSON verdict. Keep buffered HTTP output. |
| WebSocket mode | No conversation, tools or persistent session | Not applicable. Keep independent HTTP requests. |
| Zero Data Retention | No account-level ZDR requirement supplied | Do not claim ZDR. Use `store:false` for stateless verdicts; provider abuse-monitoring and project controls are separate. Send only letter/word context, never photos, email or entire order records. |
| Data residency | No new jurisdiction requirement supplied | No regional migration or residency guarantee. Retain provider default endpoint; any later residency requirement needs separate account verification. |
| Processing tiers | Interactive requests only | Standard service; no Priority, Flex, reserved capacity or asynchronous Batch workload is needed for this migration. |
| Prompt cache keys | GPT-6 | Omit new cache keys as current guidance recommends. |
| Extended retention for older models | No older model | Not applicable. |
| Explicit cache breakpoints | Reused phonics guidance; supported | One developer-block breakpoint, explicit-only mode, default lifetime. Customer input is after the breakpoint. Cache hits require the documented 1,024-token threshold; no artificial padding or guaranteed-hit claim. |
| Cache diagnostics | No suitable earlier response ID retained | Comparison IDs not applicable to isolated, stateless requests. No response chaining or new persistence introduced just to diagnose caching. |
| State management | One-shot classification | No conversation persistence or replay; full developer instructions supplied on each request. |
| Instruction persistence | Applicable, supported | Shared phonics instructions included in every single and batch call. |
| Encrypted reasoning items | No later turns or tool calls | Not applicable; nothing is replayed. |
| Reasoning effort | Existing low effort | Preserve `low`, supported by Luna. |
| Reasoning preservation | No conversation history | Cross-turn preservation not applicable. |
| Reasoning summaries / preambles | Existing UI displays verdict only | Not applicable; do not add narration. |
| Verbosity | Existing one-sentence friendly verdict | Preserve concise output using `text.verbosity:low`. |
| Output token limits | Existing single 2,048 / batch 16,000 | Preserve limits, counting reasoning and visible tokens together. |
| Assistant phases | No assistant history replayed | Not applicable. Read only final text content; ignore reasoning items. |
| Compaction | Small bounded prompts | Not applicable; no growing conversation or tools. |
| Structured outputs | Required machine-readable verdict | Strict JSON schemas for single and requested batch letters, plus runtime type checks. Incomplete/refused/malformed responses produce retry verdicts, never acceptance. |
| Tool choice | Classifier has no tools | Not applicable. |
| Tool search / additional tools | No tool catalog | Not applicable. |
| Parallel tool calls | No tools | Not applicable. |
| Programmatic tool calling | No tool orchestration | Not applicable. |
| Model-aligned tool interfaces | No tools or agent harness | Not applicable. |
| Retry / timeout / errors | Applicable | SDK timeout 30 seconds, one retry; HTTP error shape retained, upstream diagnostic strings withheld from clients and logs. |
| Credentials / deployment | Applicable | `OPENAI_API_KEY` replaces `ANTHROPIC_API_KEY` in code and setup examples. Reviewed suggestions must work even without a key; custom requests require the new key. Existing Render/Supabase settings are preserved. |

## Validation and outcome

Implemented locally: both request paths use OpenAI Responses, the official OpenAI SDK replaces Anthropic, setup examples require `OPENAI_API_KEY`, and reviewed examples work through the HTTP routes without credentials. The phonics prompt, lowercase cards, photos, audio, and form layout are preserved.

Dependency evidence: the registry's advertised latest `openai@7.57.0` tarball returned HTTP 404. Installed and pinned the registry-published `openai@6.49.0` release instead; the SDK transport test verifies that the required Responses fields are sent intact. Other application dependency versions were preserved.

Validation passed: all 19 tests across `test/openai-validation.test.js`, `test/phonics.test.js`, `test/word-editing.test.js`, and `test/letter-audio.test.js`. Seven new tests cover real SDK request serialization with mocked transport, typed output parsing, refusals/incomplete/malformed output, batch isolation, upstream failure, and real localhost HTTP routes. Syntax checks passed for the changed runtime JavaScript. Local tests do not call the paid API or alter customer records. Localhost checks required sandbox approval; the unrestricted run passed.

Setup: put a securely provisioned key in the ignored `.env` file for local verification and set the same `OPENAI_API_KEY` through the existing Render service's Environment settings. No local credential has been created or written yet. The existing server reads `.env`, not `.env.local`.

Pending: secure picker organization/project selection and destination confirmation; live custom-word quality checks and account/model availability; GitHub publication and Render release. Keep the running service on the existing version until the migration and its key are ready; the original Render service also shares this repository, so merging a provider replacement can require its manager to configure the new key or disable that service's automatic deploys.

Sources checked 2026-11-13: [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). Original Anthropic call sites: `routes/api.js` and `lib/validation.js`.

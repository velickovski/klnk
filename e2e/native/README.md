# Native candidate verification

Status on 27 October 2026: **blocked / not run**. This Windows workstation has no macOS/Xcode build host, signed iPhone artifact or physical iPhone evidence. Browser tests do not satisfy this gate. No native runner or SDK was installed, no signing resource was changed, and no cloud build was initiated.

Use the existing Expo development-build workflow in [iPhone setup](../../docs/IPHONE_SETUP.md). Keep simulator UI tests and physical-device audio tests separate. The currently gated native Live hook is not a supported full-duplex transport.

## Reproducible candidate identity

Record Git revision and dirty-file identity; candidate version/build; application bundle ID; exact `.app`/archive SHA-256; Expo/RN/native transport versions; Xcode/SDK; named simulator runtime/device or iPhone model/iOS; API origin and capability configuration without credentials. Use a disposable fictional owner and simulation with telephone execution disabled.

On an authorized macOS host, discover available runtimes/device types with `xcrun simctl list -j devices available`, `xcrun simctl list runtimes` and `xcrun simctl list devicetypes`. Choose an explicit available UDID rather than copying a sample. Boot and wait using `xcrun simctl bootstatus <UDID> -b` before installing the simulator `.app`; a signed device `.ipa` is not a simulator application. Do not erase a shared simulator or change another app's permissions.

## Automation strategy

Use an XCTest UI target on the generated iOS project for the exact simulator artifact, with semantic accessibility labels/identifiers rather than layout coordinates. Keep generated iOS changes and runner/dependency selection under the orchestrator's approval. This is a strategy and acceptance checklist, not a checked passing XCTest suite. No unverified Detox/Maestro compatibility claim is made for Expo 58/RN 0.88.

Automate one opening action, workspace recovery, typed request/authorization/results, contact and memory CRUD, failed-save retention, settings drafts, auth expiry, app terminate/relaunch, modal focus restoration and enabled/selected/checked states. Provide test IDs only where semantic labels cannot uniquely identify a target. Server fixtures must preserve the real API, owner and authorization boundaries.

## Common-task by accessibility matrix

Run every row with VoiceOver, Voice Control (both Show Names and Show Numbers), Switch Control and Full Keyboard Access. Record pass/fail/blocked per cell and artifact rather than one blanket accessibility claim.

| Common task | Required observable result | Current result |
| --- | --- | --- |
| Opening and capture denial | Call klnk is the sole opening action; no incidental capture; readable recovery reaches the typed workspace | Blocked on exact native artifact/device |
| Typed delegation and review | Whole request completes without hearing/speech; recipient, policy, authorization, simulation and evidence remain distinguishable | Blocked |
| People and Memory | CRUD, validation, search, private disclosure/provenance, save failure and Save/Discard/Stay remain operable | Blocked |
| Settings and identity | Retained drafts, origin/session changes, export and deletion state remain understandable | Blocked |
| Modal navigation | Escape/dismissal on every exit path restores trigger or logical focus; background is unavailable while modal | Blocked |
| Playback and live controls | Stop playback, finish capture, end Live and cancel outbound request have distinct meanings and accurate announcements | Blocked |

Repeat at every accessibility text-size category, Bold Text, Increase Contrast, Reduce Motion, Reduce Transparency, portrait safe areas, software keyboard and supported hardware keyboard. Verify at least 44×44 pt effective targets, disjoint hit regions and no clipped authorization or primary action. Simulator can inspect UI/permissions; physical hardware must establish actual input and accessibility behavior.

## Physical iPhone audio/lifecycle matrix

VOICE-06/A11Y-03/A11Y-04 remain blocked until a documented supported native Live transport and signed iPhone candidate exist. Verify permission prompt/deny/revoke, actual microphone and speaker, headphones/Bluetooth, route changes, real interruption/barge-in, system telephone interruption, background/foreground, screen locking, network loss, repeated tap, late creation, uncertain closure, mute acknowledgement and end cleanup. Never create another paid session after ambiguous creation before reconciling its receipt. Use fictional owner speech and no recipient telephone call.

Record 20 start/end cycles for retained audio/resource growth and 20 conversational response runs for median/p95 measured after the utterance ends. Greeting latency and synthetic-audio browser playback are separate observations. A human listening/usability assessment is required for naturalness claims.

## Release archive gate

Audit the exact release archive and embedded SDK manifests, purpose strings, entitlements, secret scan, runtime data flows, privacy labels/policy, review access, deletion flow and supported device screenshots. `supportsTablet: true` must be reconciled with actual iPad support evidence or an explicitly selected iPhone-only release configuration by its owner. Fetch current Apple requirements again for the actual submission date. No App Store or accessibility declaration is certified here.

Required local skills read for this strategy: [accessibility](C:/Users/andre/.codex/skills/ios-accessibility/SKILL.md), [simulator](C:/Users/andre/.codex/skills/ios-simulator/SKILL.md), [App Store review](C:/Users/andre/.codex/skills/app-store-review/SKILL.md). Official sources fetched 27 October 2026: [review guidelines](https://developer.apple.com/app-store/review/guidelines/), [upcoming requirements](https://developer.apple.com/news/upcoming-requirements/), [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api). The reason-API HTML endpoint required JavaScript; archive-specific reason-code validation remains unrun.

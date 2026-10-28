# Sources and design decisions

Reviewed 2026-10-26. Apple guidance informs interaction and material hierarchy; the user's image controls the selected visual direction. Exact klnk geometry, copy, colors and implementation stages are original project decisions.

## Primary references

| Source | Application in klnk |
| --- | --- |
| [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Reserve special glass treatment for navigation/controls; keep content readable and restrained |
| [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | System type, legibility, hierarchy and adaptation; 17 pt native body baseline |
| [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Brief purposeful feedback, optional motion and responsive controls |
| [Apple Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | Stable labeled navigation in the advanced workspace; no tabs on the user's one-button demo |
| [Apple Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Native target sizes, adaptable appearance, type and assistive input |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Measurable web accessibility and complete-process conformance |
| [WCAG2ICT](https://www.w3.org/TR/wcag2ict-22/) | Informative application of WCAG concepts to non-web software |
| [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1) | Current premier expressive voice model; actual account access must be tested |
| [GPT-Live guide](https://developers.openai.com/api/docs/guides/live) | Separation of real voice conversation and delegated backend reasoning |
| [Voice WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc) | Browser audio connection with trusted server session creation |

The user supplied `Mobile-app-design-trends-1024x769.webp` as a visual reference. It suggests curved navy and pale surfaces with coral calls to action. It supplies no evidence about API behavior, accessibility or Apple authorship. Its UI is not copied into production as an image.

## Decision record

| ID | Decision | Reason / consequence |
| --- | --- | --- |
| D01 | Keep React Native/Expo for the existing mobile app | Preserve working product behavior and installed stack |
| D02 | One visible opening Call klnk button | Explicit user preference; connected/recovery controls appear when relevant |
| D03 | Navy, pale lavender and coral replace the initial periwinkle demo direction | Matches the subsequently supplied reference |
| D04 | Separate local browser demo from advanced workspace | Supports a recordable real conversation without inventing native WebRTC support |
| D05 | Real GPT-Live conversation; optional explicitly granted local in-app tools | Supersedes the tool-free baseline after durable identity/session and gateway checks. External effects stay disabled; voice/model text does not create mission authority. |
| D06 | API key on server; local-only demo | No browser-bundled project credentials or public unpaid gateway |
| D07 | Generated original hero illustration | Cohesive visual asset without using unrelated stock imagery or copying reference art |
| D08 | AA release baseline, AAA targets with evidence | Craft labels are not accessibility certification |
| D09 | Opaque baseline, optional native material enhancement | Legible, portable and implementable by 6.1 Sol using current stack |
| D10 | Backend state remains truth for mission workspace | A visual polish pass cannot fabricate success or broaden permissions |
| D11 | Share the design and authenticated broker with Expo web | One-action opening, reactive tokens and preserved advanced workspace; explicit subsequent-screen link |
| D12 | Preserve uncertain session identity and block duplicate starts | Local disconnection is not provider closure; readback and matching events supply evidence |
| D13 | Native Live remains explicitly unsupported | Installed Expo recording/playback is not a continuous WebRTC transport; no unverified SDK added |
| D14 | Manual-send mode and hold at capture cap | Silence timers are optional; reaching 30 seconds does not authorize submission |
| D15 | Keep the brand panel on light semantic controls | The fixed lavender surface needs navy focus, even while workspace appearance follows a dark OS |
| D16 | Adaptive workspace tabs at narrow widths or large native text | Two rows at <=360px or fontScale >=1.6 avoid single-letter labels; icon containers use intrinsic size rather than clipping enlarged glyphs. Independent browser text/hitbox checks passed; native remains unrun. |
| D17 | Permissions, connections and sanitized activity live in subsequent Settings | Preserve the sole opening action. Account-granted lookups/draft preparation do not enable phone, messaging or Calendar writes. |
| D18 | Explain copied context at memory deletion and invalidate changed draft reviews | Approved requests retain their immutable permitted context; contact/context edits require a current review rather than silently changing disclosure. |
| D19 | Internal network workspace after the sole Call klnk opening | Inbox, internal Calendar, member People, private Memory and autonomy Settings use the existing semantic design system. Retained hidden panels preserve drafts across tabs while excluding them from accessibility traversal. Earlier telephone records have an explicit compatibility entry. Flexible two-row navigation supports enlarged text; native validation remains separate. |

Implementation references rechecked on 2026-10-27: [Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [create session](https://developers.openai.com/api/reference/resources/live/methods/create), [SIP hangup](https://developers.openai.com/api/reference/resources/live/subresources/sessions/methods/hangup). The SIP-specific REST description was not generalized to WebRTC cleanup.

When changing a decision, update this table and its owning specification together. Do not leave two conflicting “current” design directions.

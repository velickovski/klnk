# Accessibility and quality

Status: implementation requirements, not a completed accessibility audit. Reviewed against official sources on 26 October 2026.

Scope distinction: the current user-selected demo opens with one Call klnk button. Make that control keyboard/screen-reader operable; expose the separate text workspace after capture denial without adding a competing opening CTA. The Live demo has no implemented typed-input protocol; this is an explicit accessibility gap, not full text/voice parity. The existing Expo recorder timing audit below applies to its ElevenLabs turn adapter; the new GPT-Live browser transport requires a separate timing and interruption assessment.

The visual ambition is exceptional craft. The measurable accessibility target is WCAG 2.2 AA for the web client, with AAA criteria pursued wherever applicable. Prefer AAA text contrast and larger targets from the first implementation. A passing palette does not establish AAA conformance. Every applicable criterion and every step of a complete process must be evaluated before making a conformance claim. An unresolved A or AA failure cannot be described as an acceptable AAA-to-AA downgrade. [WCAG 2.2 conformance requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs)

For the native iPhone client, use Apple accessibility behavior and document the applicable WCAG requirements with [WCAG2ICT guidance](https://www.w3.org/TR/wcag2ict-22/). WCAG2ICT is informative guidance, not a separate certification. Browser previews cannot verify native accessibility.

## Visual requirements

| Area | klnk requirement | Verification |
| --- | --- | --- |
| Text | Target at least **7:1** for normal text and **4.5:1** for large text, including secondary labels, placeholders and status labels. | Check every foreground/background pairing in both appearances. [AAA contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) |
| AA fallback | At least **4.5:1** normal text and **3:1** large text. Record any intentional AAA shortfall in the issue ledger. | On the web, large text means at least 24 CSS px regular or approximately 18.67 CSS px bold; do not equate this to native point sizing. [AA contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| Controls and state | Meaningful icons, control boundaries where needed for identification, and state indicators achieve **3:1** against adjacent colors. | Check selected, pressed, error and keyboard focus states, not only idle. Decorative separators may be subtler. [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| Glass and color | Text-bearing surfaces have a stable opaque base. Decorative translucency never controls legibility. State always has a label or symbol in addition to color. | Check over the brightest and darkest content behind chrome. Increase Contrast strengthens necessary boundaries; Reduce Transparency makes materials opaque. [Apple accessible appearance](https://developer.apple.com/documentation/swiftui/accessible-appearance) |
| Native text | Use a 17 pt body baseline, scalable text and flexible containers. Respect Dynamic Type and Bold Text. No essential text truncation or fixed-height text boxes. | Check default and every accessibility text-size category on iPhone. Apple encourages enlargement of at least 200%. [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Web resizing | Support 200% text enlargement and vertical reflow at 320 CSS px without loss or two-dimensional scrolling in ordinary screens. | Test both text enlargement and 1280 px viewport at 400% zoom. [Resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |
| Web text spacing | User overrides must not clip content: line height 1.5×, paragraph spacing 2×, letter spacing 0.12× and word spacing 0.16× font size. | Apply all overrides together. These are test settings, not required default typography. [Text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) |

Compute WCAG contrast from the resolved sRGB colors, including opacity compositing, using `(lighter relative luminance + 0.05) / (darker relative luminance + 0.05)`. Do not round a failing result upward. Static token results must be supplemented by inspection of actual rendered states.

## Input, focus and semantics

- **Native targets:** klnk uses at least 44 × 44 pt effective targets, including tab items, close, disclosure and replay controls. Apple's current HIG lists 44 × 44 pt as the iOS default and 28 × 28 pt as the minimum; klnk deliberately adopts the stronger floor. Keep expanded hit regions disjoint. [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- **Web targets:** use at least 44 × 44 CSS px for standalone interactive targets, pursuing AAA 2.5.5. Do not confuse CSS pixels, physical pixels and iOS points. AA 2.5.8 generally requires 24 × 24 CSS px or its documented spacing/other exceptions; klnk should not depend on those exceptions for its main controls. [Enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [Minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- **Keyboard:** complete onboarding, text delegation, review, results, contacts, memory and settings without touch. Keep logical tab order, a visible focus indicator and no keyboard traps. Modal dismissal restores focus to its trigger; a modal's background is unavailable to assistive technology while open.
- **Focus:** keep the entire focused control visible above the keyboard and bottom navigation. For custom web focus, target a solid indicator with at least the area of a 2 CSS px perimeter and 3:1 change between focused and unfocused pixels. Check both themes and nearby surfaces. [AAA focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- **Names and roles:** visible labels must be included in accessible names. Announce selected tabs, expanded disclosures, disabled controls, busy submissions and field errors. Group a request row as one understandable element only when its actions remain individually operable. Decorative light forms and ornaments are hidden from assistive technology.
- **Updates:** announce meaningful transitions once: “Listening,” “Processing your request,” “Simulated request queued,” and the actual persisted outcome. Do not announce every waveform frame or polling refresh. Keep focus where the person is working. [Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- **Native implementation:** use supported React Native accessibility properties and platform APIs; verify actual VoiceOver output on device. Do not assume a web `aria-live` implementation or an Android live-region property provides equivalent iOS announcements.
- **Authentication:** allow paste, password managers and autofill. Keep errors associated with their fields, preserve entered values where safe and avoid memory puzzles. [Accessible authentication](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)

## Voice must remain optional

The text path is an equal way to delegate. It must remain visible before microphone permission, during permission denial and after a speech failure. It uses the same policy checks, clarification and results as speech. Instructions, agent replies, permissions and outcomes remain readable; no action depends only on hearing a sound, recognizing a pulse, or responding aloud.

Keep separate controls and meanings for **Finish speaking**, **Stop audio**, and **Cancel request**. Stopping playback must not imply that a queued call has been cancelled. No recording starts on page load. If an ongoing clarification session automatically opens the microphone after a reply, explain that behavior before starting and provide a persistent way to end the session. Screen-reader speech must not become the user's recorded command.

Offer replay only when actual audio is available. Preserve the actual textual reply when synthesis fails. Use captions/transcripts for any introduced prerecorded instructional media. For live telephone activity, explain that live transcript availability depends on the actual provider capability; an unavailable transcript must never be invented.

### Implemented timing behavior and remaining evaluation

The advanced recorder offers After a pause and Manual send. The first uses 2 seconds of measured silence after speech and an 8-second initial-silence discard; Manual send disables both timers. Both stop and hold a recoverable message at the 30-second capture cap for explicit Send or Discard. Tests verify that the cap does not submit automatically. Capture and backend payload limits are unchanged. Actual native speech-service timing and accessibility behavior still need device evaluation.

The implemented manual-send option must continue to disable silence-based submission, communicate capture limits and preserve a recoverable draft. Any longer capture mode must remain within verified provider and server payload limits. Do not silently change those backend limits during a visual refactor. Keep the evaluation gap open until the implemented voice flow has been assessed against [Timing Adjustable, Level A](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html) and [No Timing, Level AAA](https://www.w3.org/WAI/WCAG22/Understanding/no-timing.html). An untimed text path improves access but is not, by itself, proof that every offered voice interaction conforms.

## Motion and feedback

Use brief motion to communicate state or hierarchy; inputs remain available during transitions. No continuous decorative orbit, strobe, parallax or simulated camera movement. Under Reduce Motion, render a static listening form and use immediate state changes or a short opacity transition. Preserve textual feedback. Under Reduce Transparency, use opaque surfaces. Apply preference changes during the session, not only on launch. [Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Apple Reduced Motion evaluation criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)

Haptics may reinforce a recording start or completion, but never carry the sole indication. Do not create a fake microphone waveform: use a real level signal if available, otherwise a static listening indicator.

## Acceptance matrix

Run these checks on the actual implementation, including loading, empty, error and populated states.

| Check | Required scenarios | Evidence |
| --- | --- | --- |
| Visual layout | Light/dark; 320, 390 and 430 CSS px web; native supported sizes; long names and paragraphs; keyboard open; landscape where supported | Screenshots with viewport and text scale |
| Native adaptation | Largest Dynamic Type sizes, Bold Text, Increase Contrast, Reduce Motion, Reduce Transparency | Device/OS/build and observations |
| Screen readers | VoiceOver on iPhone; a supported web browser/screen-reader pairing; complete one text request and inspect its outcome | Traversal order, announced labels, focus restoration and errors |
| Alternative input | Keyboard, Voice Control and Switch Control for primary tasks | Actual completed task record, not an API-property checklist |
| Voice recovery | Permission denied; missing credentials; silence; slow speech; interrupted app; playback failure; retry; end clarification session | No lost draft, accidental submission or false success |
| Trust | Simulation badge; disabled calling; ambiguous person; unverified analysis; cancellation pending; partial result | State and copy match persisted truth |
| Web audit | Automated accessibility scan plus manual keyboard, contrast, 200% resize, reflow and text-spacing checks | Tool/version, findings and manual results |
| Performance | Typing while polling; long conversation; opening a detail sheet; reduced motion | Profiled device/build; no visible input stalls or repeated focus resets |

Keep a full criterion-by-criterion WCAG 2.2 A/AA/AAA applicability audit for the release scope. This matrix prioritizes klnk risks; it is not a substitute for that audit. Include media alternatives, language, orientation, instructions, error prevention, pointer alternatives and complete-process behavior even when they seem unrelated to visual design.

## Evidence and exception ledger

Use one row per issue or unverified criterion. Do not hide unresolved items behind a percentage score.

| ID | Screen/state | Criterion or native behavior | Reproduction and impact | Target | Owner | Status | Evidence / fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-001 | Voice capture | Timing Adjustable / No Timing | Bounded voice capture can interrupt speech | A baseline / AAA aspiration | Implementer | Partly resolved; evaluation open | Manual mode disables pause timers; 30s holds instead of submits. Automated timing tests pass; native/WCAG evaluation remains open |
| A11Y-002 | All native screens | VoiceOver and Dynamic Type | Browser previews cannot establish native behavior | Release requirement | Implementer | Not tested | Record physical iPhone build and OS |
| A11Y-003 | All implemented screens | Full WCAG coverage | Design specification is not a conformance assessment | AA baseline | Reviewer | Not tested | Complete applicability audit |
| A11Y-004 | Live browser demo | Equivalent non-speech use and timing | Captions exist, but typed interaction is in a separate workspace; five-minute cap needs evaluation | AA baseline / AAA aspiration | Implementer | Open | Do not claim whole-demo AA/AAA conformance |

Record the build identifier, platform, OS/browser, assistive technology, test date, tester, applicable criteria and exact evidence. Mark results `Pass`, `Fail`, `Not tested`, or `Not applicable` with a reason. Full AAA can be claimed only after the whole defined scope passes every applicable A, AA and AAA requirement. Until then, describe verified individual improvements and the remaining gaps accurately.

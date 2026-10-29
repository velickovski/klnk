# Design system

The immediate demo uses the user's navy/lavender/coral direction. The generated illustration is decorative and must not become a second button. See [00](00-current-brief.md).

## Current demo palette

The demo intentionally combines a dark hero with a pale conversation surface. This fixed brand composition is distinct from the advanced workspace's future system-appearance themes. Runtime values live in `apps/voice-demo/styles.css`.

| Token | Value | Intended pair and calculated contrast |
| --- | --- | --- |
| `navy` | `#191D3A` | Hero canvas; text on coral |
| `lavender` | `#ECEEFC` | Conversation surface |
| `ink` | `#202440` | On lavender: 13.12:1 |
| `muted` | `#414864` | On lavender: 7.79:1 |
| `cream` | `#FFFDF9` | On navy: 16.17:1 |
| `on-navy-muted` | `#C2C6E3` | On navy: 9.76:1 |
| `coral` | `#FF899A` | Navy button label: 7.27:1 |
| Required control edge | `#717B9E` | On lavender: 3.62:1 |

These are static sRGB contrast calculations, not a complete conformance result. The disabled setup control is intentionally distinct; test every rendered interaction and state separately. The coral primary action uses a phone handset icon and the visible label Call klnk. The decorative image has empty alternative text and an assistive-technology-hidden wrapper.

These are implementation values, not a mood board. Use semantic tokens in `src/design/tokens.ts` and a reactive theme provider. React Native units map to platform layout units; CSS values in the reference are CSS pixels. Neither is a physical-pixel specification.

## Advanced workspace theme palette

The following paired themes are the detailed workspace specification. When unifying the workspace with the demo, use the current coral family for primary actions and recompute contrast; keep semantic status colors distinct. Do not let the older blue accent drive the demo's visual identity.

| Semantic token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#ECEEFC` | `#0E1228` | Pale lavender app canvas / dark system appearance |
| `surface` | `#FFFFFF` | `#191D3A` | Content groups and sheets |
| `surfaceRaised` | `#E9EDF5` | `#252B47` | Selected rows, input grouping |
| `text` | `#151924` | `#FFFDF9` | Primary content |
| `textSecondary` | `#414864` | `#C2C6E3` | Supporting text and placeholders |
| `accent` | `#203D87` | `#FFD2DA` | Links and selected state |
| `onAccent` | `#FFFFFF` | `#191D3A` | Content on solid accent |
| `action` / `onAction` | `#FF899A` / `#191D3A` | Same | Coral primary action; strong control border |
| `actionPressed` | `#FFC2CC` | Same | Visible pressed fill; label/edge stay opaque |
| `borderStrong` | `#66738A` | `#8893B2` | Required control edges |
| `success` | `#135437` | `#A6DEC4` | Verified successful state label |
| `warning` | `#704200` | `#FFD699` | Needs attention label |
| `danger` | `#8E2035` | `#FFB4BE` | Destructive action/error label |

Use semantic status colors as foregrounds on the three opaque surfaces. Do not assume white text on a danger or success fill passes. For destructive actions, use a danger-colored label and strong boundary on a neutral surface. Other status fills require separate measured pairs before introduction.

### Verified token contrast

Current palette pairs are checked by `apps/mobile/test/design-contrast.test.ts` using the WCAG sRGB formula. It covers normal text/status foregrounds against opaque surfaces, coral action labels, and required/pressed control edges. Use these current executable checks rather than numerical tables from the earlier palette.

These calculations do not verify the rendered app, alpha blends, disabled/pressed states or full accessibility conformance. Keep status and explanatory text at full opacity. Use background changes for presses; avoid fading whole controls and their labels.

## Typography and spacing

Use the platform system family. Web fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Native uses the default system family with scalable `Text`. Do not set `allowFontScaling={false}` or cap essential content just to preserve a screenshot.

| Role | Base size / line height | Weight | Usage |
| --- | --- | --- | --- |
| Hero | 34 / 40 | 600 | Empty Home only; at most three short lines |
| Page title | 28 / 34 | 600 | People, Memory, Settings, detail title |
| Section | 21 / 28 | 600 | Outcome, review section |
| Body | 17 / 25 | 400 | Replies, requests, transcript, fields |
| Action | 17 / 24 | 600 | Buttons and primary list title |
| Supporting | 15 / 22 | 400 | Status explanation and metadata |
| Caption | 13 / 18 | 500 | Noncritical timestamp or section context |

These are default values; containers grow with text scaling. Avoid all-caps paragraphs and overly tight tracking. Use tabular figures only for durations and comparable times. The active conversation collapses the empty-state hero to a small title so actual messages stay visible.

Spacing scale: **4, 8, 12, 16, 20, 24, 32, 40, 48**. Screen side inset is 24 at typical phone width, 16 below 375, 32 above 600. Content section gap is 24; label-to-field gap is 8; related rows use 12–16. Use 8 between adjacent targets and do not overlap expanded hit regions.

Radius tokens: `control=16`, `group=24`, `sheet=32`, `capsule=999`. Use continuous-looking curves where the supported platform can provide them; ordinary rounded corners are the fallback. Borders are 1 layout unit; focus outline on web is 3 CSS px with a 3px offset. Verify the focus pair against its adjacent surface.

## Layout and materials

Phone content is edge-to-edge within safe insets. Never implement a fake phone frame inside the production app. The preview frame belongs only to the reference. At 600–899 wide, center content at max 560; at 900 and wider use max 720 for the first implementation. Long text remains readable and controls reflow; a tablet redesign can follow separately.

Content uses opaque surfaces. Navigation can use a subtle elevated capsule with the same strong text contrast. Baseline elevation is `0 8px 24px rgba(0,0,0,0.12)` in light and `0 8px 24px rgba(0,0,0,0.30)` in dark for web reference; use supported native shadow APIs after checking the installed RN version. Shadows are decorative and never the only boundary.

Native Liquid Glass is optional and limited to navigation or a small transient control. Verify a supported Expo/native implementation before adding it. Do not simulate glass by putting low-opacity text/cards over moving gradients. Reduce Transparency and unsupported platforms use opaque `surface`. The baseline must look finished without blur.

Bottom navigation uses actual bottom safe-area inset plus 8 padding, 8 top padding, four equal-width targets with a 56-unit minimum height. Labels can grow and wrap at large text sizes; do not force a fixed-height bar. Scroll content reserves the measured bar height only if the bar overlays it. Prefer layout-flow navigation initially.

## Component contracts

| Component | Required behavior and states |
| --- | --- |
| `AppScreen` | Safe area, reactive background, keyboard-aware content, screen title, one principal scroll container |
| `AppText` | Semantic type role, scalable text, selectable long evidence, full-opacity labels |
| `ActionButton` | Primary/secondary/destructive; idle/pressed/focused/disabled/busy; 52 minimum height, 44 compact; optional prominent 64-unit capsule; multiline labels |
| `IconButton` | 44 minimum target, 22–24 icon, explicit accessible label; no unlabeled decorative action |
| `TextField` | Persistent label, hint, error association, placeholder token, 52 minimum height; multiline auto growth |
| `InputModeControl` | Visible Talk and Type choices; selected semantics; preserves drafts and avoids incidental capture |
| `VoiceAperture` | 96-unit control, optional decorative rings up to 144; accessible state label; no listening implication at rest |
| `ModeLabel` | Always readable Simulation / Calling unavailable / supported live state; never color alone |
| `RequestRow` | Recipient, request title, accurate status and time; 72 minimum height; one clear drill-in target |
| `StatusLabel` | Neutral/success/warning/danger semantic foreground, accompanying text; no automatic green for cancelled or unknown |
| `OutcomeSummary` | Known result first; separate evidence, unresolved items, unverified analysis and follow-up status |
| `Disclosure` | 44 minimum trigger; expanded semantics; preserves selection/focus when opening |
| `Notice` | Brief actionable explanation; inline by default; errors announced once; retry scope stated |
| `DetailSheet` | Title, Close, focus containment/restoration, keyboard avoidance, unsaved-draft handling |
| `EmptyState` | Specific missing content and relevant next action; no fake sample data in a real account |

Long forms use section headings and disclosures, not a card around every field. Authorization-critical information must remain visible in the review even if optional composer settings were collapsed.

The current workspace uses navy headers with full-width titles below the back/brand row (28 units, or the semantic 26-unit compact title below 360-wide layouts), opaque lavender/light or semantic dark content, and icon-labeled bottom tabs. Cards use continuous rounded corners and no decorative outer border; fields/actions keep their strong control boundaries. `FeatureHeader` shares decorative icon, scalable heading and optional short supporting copy. Settings uses icon-led disclosure rows for Delegation, Voice permissions, Preferences and Account; `preserveContent` lazily mounts once and hides content on subsequent collapse. No hidden field remains in browser keyboard navigation. The web row uses intrinsic minimum text width and wraps its chevron at enlarged sizes rather than fragmenting the category name. The opening hero also uses the existing 28-unit title role below 360 wide, retaining text scaling and initial call-action fit across system font fallbacks.

## Motion and feedback

Implemented home tokens in `tokens.ts`: `entranceMs=280`, `pressMs=120`, with `cubic-bezier(0.23,1,0.32,1)`. The sculpture enters once with opacity and a 12-unit translation / 0.96→1 scale; the prominent action uses a 1→0.97 press scale. Neither affects capture, dispatch timing or session state. Reanimated CSS uses browser CSS on web and its native runtime on compatible builds; native feel/performance remains unverified. Other workspace transitions should follow platform defaults; suggested state/sheet durations are not evidence of implementation.

Workspace primary actions now share the 120ms press feedback. Secondary/destructive actions retain immediate pressed fills, and peer tab changes have no slide or entrance animation. `DetailSheet` uses the existing React Native Modal fade and its original focus/escape/dismiss lifecycle; startup/reactive Reduced Motion selects `none`. Browser preference subscriptions are owned directly by each ThemeProvider through `matchMedia`, avoiding React Native Web's callback-string listener collision when a nested provider unmounts. Native preferences continue through AccessibilityInfo. No additional dependency was added for this workspace pass.

Reduced Motion checks the startup system preference and reactive design setting. It omits the decorative animation and the action's entire transform/transition style, retaining the same mounted control and keyboard focus. Backgrounding interrupts the artwork without replay on return; unmount removes the AppState listener. At rest it remains still. There are no repeating idle animations, fake waveform, glass dependency or new haptic permission.

At rest the aperture is static. Current `VoiceIO` exposes no amplitude value: show a static listening indicator and textual state. A future true level visualization requires an explicit adapter contract and tests; it is not part of this baseline. Use a standard activity indicator while preparing, without a fabricated completion percentage.

Reduce Motion removes decorative transforms and uses immediate changes or at most a brief opacity transition. Stop animation when offscreen/backgrounded. Haptics are optional enhancement only after dependency/device verification; visible and spoken-accessible feedback remains sufficient.

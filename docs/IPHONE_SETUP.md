# iPhone setup and voice-first preview

Implementation updated **29 October 2026**; the Apple enrollment references below were checked **26 October**. This Windows machine has not compiled or signed an iOS application. No Apple/Expo account, signing resource, device registration, cloud build or real call was created. See the [current review status](review/2026-10-28/STATUS.md) for exact evidence and release gaps.

## What works immediately

Open `http://localhost:8081/?preview=iphone` on this computer for the React Native application's phone-sized browser presentation. It is explicitly labeled as a browser preview. The opening has one **Call klnk** action. On web, it uses documented OpenAI Live WebRTC through the local authenticated broker, with the project key kept on the server. Captions, mute and End appear during a session. Failed live connections never become simulated audio. See [live demo validation](design/10-validation.md).

The subsequent workspace contains Inbox, internal Calendar, member People, Memory and Settings. A signed-out Call opens explicit account access before capture; no anonymous account is silently created. A dev-only inspection URL is `http://localhost:8081/?preview=iphone&workspace=1`. Local demo entry is inside a disclosure, not the default account action. Normal production navigation uses workspace/deep-link routes.

The native opening uses the network's bounded recorded-turn path while native continuous Live remains gated. It uses Expo Audio foreground capture, server-side OpenAI transcription/owner planning and actual Expo Speech device playback. Exact proposed recipient/terms are read aloud and owner confirmation binds the saved plan; no model boolean supplies authority. Capture is capped at 30 seconds on the client, the session at five minutes; the server enforces upload/day limits but does not parse media duration. Background/interruption cleanup is implemented but unverified on a device. Missing credentials do not become fabricated transcripts or audio. ElevenLabs/Twilio are not needed for this network flow.

Native local reminders use Expo Notifications only after explicit Settings opt-in. Schedules use generic text and reconcile while foregrounded/connected; quiet mode, local sign-out and account changes cancel managed schedules. APNs and remote-notification background modes are disabled. Closed-app remote edits can leave an already synchronized alert stale until the next sync. Device permission, actual alert delivery/Focus behavior and native build compatibility still need physical testing.

**Native OpenAI Live is not enabled.** The native Live hook itself never captures; the hero delegates to the separate recorded-turn panel. Installed Expo recording/playback is not a documented continuous WebRTC transport. Authenticated owner voice now permits configured non-loopback clients, with HTTPS/exact browser origins in production; the older standalone demo remains loopback-only. The GPT-Live API has no documented ephemeral-client-secret endpoint, and Realtime credentials are not substituted. Browser Live inform/ask requests remain review-gated; typed Inbox review and native exact-plan spoken review are distinct paths. No physical audio/routing success is inferred from the browser tests.

## What is needed from you for a real iPhone install

You currently have neither an Apple Developer membership nor a Mac setup. The practical Windows route is an **Expo/EAS development build with a paid Apple Developer Program membership**. EAS compiles iOS in the cloud; its development profile already targets a physical device. An Expo account with available build quota is also required. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/?buildenv=build-with-eas) documents this distinction.

Provide these non-secret decisions/identifiers when ready:

| Item | Needed value or action |
|---|---|
| Apple enrollment | Your own Apple Account with two-factor authentication and active Developer Program membership. Sign in yourself; do not paste your Apple password or verification codes into chat. |
| Apple fee | Apple currently lists USD 99 per membership year, with regional pricing/taxes and eligibility varying. Complete the purchase yourself. |
| Apple team | Your Team ID and Account Holder/Admin access to signing, identifiers and devices, or permission to use an existing organization's team. |
| App identity | A unique reverse-domain bundle identifier that your team owns, supplied as `IOS_BUNDLE_IDENTIFIER`. The repository's placeholder is not proof of ownership. |
| Expo identity | Your Expo username/organization (`EXPO_OWNER`) and real project UUID (`EAS_PROJECT_ID`), after the project is deliberately created/linked. |
| iPhone | The actual device and its iOS version. Register its UDID using the EAS device-registration flow when authorized. |
| Backend address | A reachable HTTPS API origin, or a private LAN address for trusted same-Wi-Fi development. |

Apple describes the enrollment requirements and current fee in [Program enrollment](https://developer.apple.com/help/account/membership/program-enrollment/). Expo's [internal distribution guide](https://docs.expo.dev/build/internal-distribution/) explains that an ad hoc profile includes the registered device list; adding a device can require rebuilding or resigning the app. The current membership and device status must be checked before promising an install date.

The alternative is a Mac with compatible Xcode and an Apple Account. Local Xcode Personal Team testing can use a free account, with restricted capabilities and seven-day provisioning that requires rebuilding/reinstalling. It does not provide the Windows/EAS signing path. See Apple's [developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Local configuration prepared in source

`apps/mobile/app.config.ts` reads your actual metadata without embedding provider secrets:

```dotenv
IOS_BUNDLE_IDENTIFIER=your.owned.identifier
EXPO_OWNER=your-expo-user-or-organization
EAS_PROJECT_ID=the-real-project-uuid
EXPO_PUBLIC_API_URL=https://your-api-origin
```

All `EXPO_PUBLIC_*` values are visible in the application bundle. Put only public addresses/options there. ElevenLabs/Twilio credentials belong exclusively to the backend. Populate identifiers in the selected EAS environment and in the local mobile environment for development. Expo documents how [environment variables are resolved locally and during EAS builds](https://docs.expo.dev/eas/environment-variables/usage/); local ignored `.env` files are not a substitute for the remote environment.

The development profile enables `IOS_ALLOW_LOCAL_NETWORK=true` and `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true`. Only the development build permits private LAN HTTP; it does not add unrestricted public HTTP access. Preview/production profiles have no local-network override by default. Apple's [local network usage description](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription) and [ATS local-networking guidance](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking) explain the relevant declarations. This source configuration still needs device validation.

## Connecting the installed app to this computer

1. Put the computer and iPhone on the same trusted Wi-Fi, without guest/client isolation.
2. Run the backend bound to its LAN interface (`HOST=0.0.0.0`) and the Expo development server. Keep real calling disabled.
3. Enter the computer's reachable private IP and API port in **Connect to your backend**, for example `http://192.168.1.20:4000`. This is an example, not the address of this computer.
4. Select **Allow local development HTTP** only for this trusted LAN test, then **Check connection without calling** and **Save connection & sign in**. On iPhone, `localhost` refers to the iPhone and is deliberately rejected.
5. Allow Local Network access if iOS asks. Only add a Windows firewall rule after verifying the correct network/interface and executable; no firewall rule is silently created by the app.

The backend address is stored on the iPhone. Session tokens are bound to that backend origin; changing it signs out and clears the old token before the new server is selected. A selected HTTPS hosted backend allows use away from the computer's Wi-Fi, but hosting, TLS and a public provider webhook are separate setup. A development computer must stay awake and reachable for its backend jobs to continue.

## Build/install steps reserved for account setup and authorization

The source has a physical-device development profile and guards against invented cloud identifiers. Once the actual accounts/project/device are ready, the controlled sequence is:

1. Sign in to EAS yourself and create/link the intended project; record its real owner/project UUID.
2. Register the iPhone for the chosen Apple team and confirm its inclusion in the ad hoc provisioning profile.
3. Review the resolved app configuration, account/build quota and signing destination.
4. Explicitly authorize the cloud build, then run EAS from `apps/mobile` with `build --platform ios --profile development`. This submits source and may consume build quota; it was not executed here.
5. Install from the resulting EAS device link. Enable Developer Mode if iOS requests it; Apple's [Developer Mode guidance](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) describes the restart/confirmation process. This is distinct from TestFlight installation.
6. Start the local Metro server, launch the development client and verify its backend connection. Validate account access and an internal two-member text request before an explicitly approved real recorded-voice/device test. Verify capture, readback, interruption, playback, cleanup and reminder permission separately; a browser simulation is not device evidence.

No App Store submission is needed for this development install. TestFlight/App Store distribution, privacy declarations and release review are separate milestones. Native compilation, signing, iPhone audio, VoiceOver, background/connection transitions and actual telephone behavior remain unverified until their real tests occur.

## Design provenance

The explicitly requested [mobile-ios-design skill](https://github.com/wshobson/agents/tree/main/plugins/ui-design/skills/mobile-ios-design) was read from its [SKILL.md](https://github.com/wshobson/agents/blob/main/plugins/ui-design/skills/mobile-ios-design/SKILL.md). Its clarity/deference/depth, bottom-tab/sheet hierarchy, system typography, safe-area, Dynamic Type and accessible touch-target guidance is applied to this React Native interface. SwiftUI examples are design references; the implementation remains Expo/React Native. Native accessibility and full adaptive appearance still need device review.

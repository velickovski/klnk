# iPhone setup and voice-first preview

Checked against official documentation on October 26, 2026. This Windows machine has not compiled or signed an iOS application. No Apple/Expo account, signing resource, device registration, cloud build or real call was created.

## What works immediately

Open `http://localhost:8081/?preview=iphone` on this computer for the React Native application's phone-sized browser presentation. It is explicitly labeled as a browser preview. The opening has one **Call klnk** action. On web, it uses documented OpenAI Live WebRTC through the local authenticated broker, with the project key kept on the server. Captions, mute and End appear during a session. Failed live connections never become simulated audio. See [live demo validation](design/10-validation.md).

After an attempt, **Open workspace** provides People, Memory, request review, results and Settings. The direct subsequent-screen URL is `http://localhost:8081/?preview=iphone&workspace=1`; select **Try the simulation** to inspect fictional data without starting audio. The standalone demo is also available at `http://localhost:4100/demo`.

The advanced workspace has a separate bounded turn-based voice path. Its browser input uses speech recognition where available; replies use returned ElevenLabs audio or separately labeled device speech. This is independent of the OpenAI Live connection and is never substituted for a failed Live session. Manual send disables silence submission; at 30 seconds, recording stops and waits for an explicit Send or Discard. Unsupported recognition, microphone denial and blocked playback retain the text route. Browser success does not prove native microphone or iPhone behavior.

For the native app, microphone access is requested only when the owner starts speaking. `expo-audio` captures a bounded foreground voice turn, the backend handles speech/planning, and the returned audio is played. Recording is not enabled in the background. Missing provider speech credentials do not produce a fabricated transcript or native voice reply. See the [Expo audio API](https://docs.expo.dev/versions/latest/sdk/audio/).

**Native OpenAI Live is not enabled.** The native hook explicitly reports the unsupported capability and does not request a microphone. Installed Expo audio recording/playback does not implement continuous bidirectional WebRTC. The [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc) documents the web transport used here. A compatible native transport, native build/signing and actual iPhone audio/routing tests are separate work; no unverified native WebRTC package was added. The local Live broker also intentionally rejects LAN/hosted access, so the LAN instructions below apply to the advanced workspace API, not continuous OpenAI Live.

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
6. Start the local Metro server, launch the installed development client, connect to it, then use the in-app backend connection check. Validate a simulated voice mission first.

No App Store submission is needed for this development install. TestFlight/App Store distribution, privacy declarations and release review are separate milestones. Native compilation, signing, iPhone audio, VoiceOver, background/connection transitions and actual telephone behavior remain unverified until their real tests occur.

## Design provenance

The explicitly requested [mobile-ios-design skill](https://github.com/wshobson/agents/tree/main/plugins/ui-design/skills/mobile-ios-design) was read from its [SKILL.md](https://github.com/wshobson/agents/blob/main/plugins/ui-design/skills/mobile-ios-design/SKILL.md). Its clarity/deference/depth, bottom-tab/sheet hierarchy, system typography, safe-area, Dynamic Type and accessible touch-target guidance is applied to this React Native interface. SwiftUI examples are design references; the implementation remains Expo/React Native. Native accessibility and full adaptive appearance still need device review.

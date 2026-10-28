# klnk: in-app agent network

**Latest product direction — 27 October 2026.** The user wants people to delegate to their own agents, which communicate with other klnk members' agents and organize agreements, meetings and reminders inside klnk.

Start with [the copyable Sol prompt](00-sol-prompt.md), [product contract](01-product-contract.md) and [milestones/tests](02-milestones-tests.md). This direction supersedes the earlier production plan's telephone, external messaging and Google Calendar delivery scope for the new core experience. Keep its shared engineering, accessibility, security and evidence requirements.

Local cross-account delivery, bounded coordination, matching canonical agreements and the internal calendar are now implemented. Read the [walkthrough](04-walkthrough.md) and [current evidence](reports/STATUS.md) for executed checks and remaining gates. The [previous implementation handoff](../production/reports/FINAL-HANDOFF.md) is historical evidence for the earlier product foundation, not certification of the pivot.

“In-app” means delivery, negotiation, calendar records, summaries and reminders remain within klnk. Existing owner voice and model reasoning may still use OpenAI's cloud. This does not mean offline operation or that no data leaves the device. External telephone, SMS, email, Google Calendar, device-calendar sync and APNs push are outside this first release. In-app reminders work through persisted inbox/due items; optional local device notifications require a separate platform decision.

The visual direction stays: one opening **Call klnk** action, navy/lavender/coral surfaces, original sculpture, subsequent workspace and full typed access.


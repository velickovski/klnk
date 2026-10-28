# Product and visual direction

The latest [one-button brief](00-current-brief.md) controls the demo launch screen. The workspace guidance below applies to the broader product. The final demo borrows the user's reference geometry and uses navy, pale lavender and coral, with original generated imagery.

## The job klnk does

klnk helps someone delegate a bounded conversation and understand what actually happened. The core loop is **ask → clarify if needed → execute within authority → report with evidence**. The interface should reduce effort while keeping the person in control of commitments and personal context.

The primary user is an individual on an iPhone, often using one hand or speaking while occupied. They need to know whether klnk is listening, preparing a request, contacting someone, waiting for a decision, or reporting a result. Those are different states, never one indefinite glowing animation.

## Creative direction: quiet intelligence

Use deep navy and pale lavender surfaces, precise system typography, a restrained coral action, generous spacing and original sculptural imagery. The futuristic quality comes from continuity, immediate feedback and clarity. Ordinary workspace lists, forms and settings should remain familiar.

The signature image is a sculptural connected form in pearl and lavender. It is decorative, stationary and never evidence that a call is active. The distinct coral Call klnk control is the only opening action. In active conversations use actual connection status and audio events for feedback.

| Design intention | Concrete result |
| --- | --- |
| Content leads | The request, recipient and outcome are larger and more prominent than branding |
| Clear hierarchy | One main action per state; a nearby visible typed alternative on Home |
| Familiar navigation | Four labeled destinations remain in place; sheets have an explicit Close action |
| Depth has a purpose | Navigation may float above content; transcripts and review details stay opaque |
| Calm precision | Stable layout during polling, concise status text, no invented progress percentages |
| Personal control | Explicit microphone state, immediately available Stop, editable drafts, bounded authorization |
| Accessible by design | Scalable type, high contrast, 44-unit targets, keyboard paths and motion alternatives |

These choices apply Apple's public material hierarchy: reserve glass treatment for navigation and controls, using it sparingly. The exact palette, aperture and geometry are klnk decisions. See [sources](08-sources-and-decisions.md).

## Visual composition

The demo Home has a small `klnk` wordmark, understandable readiness text, a welcoming title, the illustration and one call button. Workspace history and data controls remain elsewhere. Avoid multiple hero cards, stat dashboards, gradients behind paragraphs, neon outlines or a multicolor Siri imitation.

Light and dark are equal designs. Production follows the system by default; the preview can start dark to show the direction. The accent marks an action or selected state. Success, warning and danger colors always accompany a word or icon; a green ring never means that a message was delivered.

Use the existing icon library with a single outline weight. Use system fonts on each platform; do not download or bundle Apple fonts for the browser. Keep the lowercase `klnk` wordmark typographic until a separate identity task is commissioned.

## Voice and writing

Use short, concrete sentences. Address the user as “you.” Say “Your agent” only when distinguishing the agent from the recipient. Use “request” in general UI and “conversation” for the delegated interaction; keep `mission` in internal contracts.

| Situation | Preferred copy |
| --- | --- |
| Idle | “What can I take care of?” / “Talk to klnk” / “Type instead” |
| Recording | “Listening” / “Finish message” / “Discard recording” |
| Preparing | “Preparing your request…” |
| Ambiguous person | “Which Jordan did you mean?” |
| Synthetic result | “Simulated result · No one was contacted.” |
| Call ended, outcome unverified | “Call ended. The provider's summary is unverified.” |
| Disconnected after submission | “Connection lost. Your request may still be running.” |
| Follow-up failed | “The conversation is complete. The calendar update failed.” |

Avoid “Done” without an object, “Always listening,” “Private on your device,” “Verified” without evidence, and “Delivered” based only on call completion. Use readable dates with the relevant timezone. Anchor relative-time messages to the original instruction time, as the existing server does.

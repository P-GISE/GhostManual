# GhostManual design system

## 0. Research Log
Read omo frontend design, perfection, designpowers Lane C, taste and Notion references. Chosen direction: Korean document workbench, inspired by Notion's readable document hierarchy. References are inspiration, not brand assets. External screen research and image generation are unnecessary for a text-first workflow and remain unperformed.

## Direction and personas
Calm paper workbench for a departing owner who verifies instructions and a successor who checks evidence. Review status and source provenance always precede polish. Density 5, variance 3, motion 1. No decorative illustrations, gradients or marketing hero.

## Tokens
Background #f6f5f1; surface #fffefa; ink #242a29; muted #616a66; border #d9ddd5; accent #28624d; accent pale #edf3ee. System Korean fonts. Type 14/16/20/32/44px; line-height 1.7 for document text. Space 4/8/12/16/24/32/48/64px. Radius 4px. No shadows. Content max 1120px; prose max 760px. Focus 3px accent outline with 3px offset. Minimum target 44px. Motion 120ms color only, disabled for reduced motion.

## Components and state
Shell: compact wordmark, owner navigation, paper content and policy footer. Document rows have title, textual review status and revision. Inputs have persistent labels, help text and connected errors. Buttons use one filled primary action and outlined secondary action. Errors retain entered content. Loading is text in live region. Empty states provide an actionable next step.

## Accessibility constraints
Semantic landmarks, skip link, native controls, keyboard focus, no color-only status, text-rendered untrusted content. Mobile stacks document and source, wraps navigation and actions. Reader view hides owner navigation/actions and explicitly identifies shared access. Review acknowledges unresolved facts.

## Accepted debt and verification
Legal text remains an operational draft until operator details and retention policy are approved. Actual browser evidence and keyboard/mobile assessment are owned by parent QA. No visual or accessibility pass is asserted before those results.
